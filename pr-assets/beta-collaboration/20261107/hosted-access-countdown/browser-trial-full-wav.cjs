'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,expect}=require('@playwright/test');
const supplied=JSON.parse(fs.readFileSync(0,'utf8'));
const origin='https://stalemate-hangout-beta.jeffstory007.workers.dev';
const issuer='https://webjam-turn-credentials.jeffstory007.workers.dev';
assert.equal(new URL(supplied.invite).origin,origin);assert.equal(new URL(supplied.invite).pathname,'/join/');
assert.equal(supplied.seconds,40);
const output='c227-generated-browser-proof-full-wav.json';assert(!fs.existsSync(output));
const proof={original20SecondFailedTrialPreserved:true,fullOriginalWavDuration:true,state:'STARTING',startedAt:new Date().toISOString(),platform:'Ubuntu26.04.1 x86_64/WSL2 Linux Chromium',generatedAudioOnly:true,physicalCapture:false,recording:false,actualSharedTrackSender:false,humanHearingQualified:false,sandboxRequired:true,browserOutputMuted:true,generatedMicrophoneFixtureOnly:true,automatedHeadphoneCheckboxForMutedGeneratedSignalsOnly:true};
let browser,context,page,replay,stage='launch sandboxed Linux Chromium';
const watchdog=setTimeout(()=>{proof.watchdogTriggered=true;if(browser)void browser.close().catch(()=>{});},95000);watchdog.unref();
const redact=error=>{let text=String(error.message);for(const value of [supplied.betaKey,supplied.invite,new URL(supplied.invite).hash])if(value)text=text.split(value).join('[redacted]');return text.slice(0,1200);};
async function sample(page,seconds) {
 return page.evaluate(async duration=>{
   const startedAt=performance.now();
   const stream=document.getElementById('host-audio').srcObject;
   const peer=window.__nucToneProof.peers.at(-1);
   const audio=new AudioContext({sampleRate:16000});
   try {
     await audio.resume();
     const analyser=audio.createAnalyser();
     analyser.fftSize=2048;
     analyser.smoothingTimeConstant=0;
     const source=audio.createMediaStreamSource(stream);
     const silent=audio.createGain();
     silent.gain.value=0;
     source.connect(analyser).connect(silent).connect(audio.destination);
     const bins=new Float32Array(analyser.frequencyBinCount);
     let toneWindows=0, disconnectedWindows=0;
     const musicalWindows={E:0,G:0,A:0};
     for(let i=0;i<duration*4;i++){
       await new Promise(r=>setTimeout(r,250));
       if(peer.connectionState!=='connected'){disconnectedWindows++;continue;}
       analyser.getFloatFrequencyData(bins);
       const band=hz=>Math.max(...bins.slice(Math.round(hz*2048/16000)-1,Math.round(hz*2048/16000)+2));
       if(band(650)>-75&&band(650)>band(710)+8)toneWindows++;
       const chordBands=[['E',164.81],['G',196],['A',220]];
       const [name, level]=chordBands.map(([name,hz])=>[name,band(hz)])
         .sort((a,b)=>b[1]-a[1])[0];
       if(level>-61&&level>band(275)+6) musicalWindows[name]++;
     }
     const stats=await peer.getStats();
     const out={elapsedMs:Math.round(performance.now()-startedAt),toneWindows,disconnectedWindows,musicalWindows,seconds:duration,state:peer.connectionState,delayMs:null,packetsSent:0,packetsReceived:0,lost:0};
     const delay=document.getElementById('latency').textContent.match(/([0-9]+) ms/);
     if(delay)out.delayMs=Number(delay[1]);
     for(const item of stats.values()){
       if(item.type==='inbound-rtp'&&(item.kind??item.mediaType)==='audio'){out.packetsReceived+=item.packetsReceived??0;out.lost+=item.packetsLost??0;}
       if(item.type==='outbound-rtp'&&(item.kind??item.mediaType)==='audio')out.packetsSent+=item.packetsSent??0;
       if(item.type==='transport'&&item.selectedCandidatePairId){
         const pair=stats.get(item.selectedCandidatePairId);
         out.path=[stats.get(pair?.localCandidateId)?.candidateType??null,stats.get(pair?.remoteCandidateId)?.candidateType??null];
       }
     }
     return out;
   } finally {await audio.close();}
 },seconds);
}
(async()=>{try{
 browser=await chromium.launch({headless:true,chromiumSandbox:true,args:['--mute-audio'],timeout:20000});proof.browserVersion=browser.version();context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',route=>[origin,issuer].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
 stage='ordinary private invitation and guest identity';const lobby=await context.newPage();await lobby.goto(origin+'/beta/',{timeout:15000});await lobby.getByLabel('Invitation code').fill(supplied.betaKey);await lobby.getByRole('button',{name:/Enter the community/}).click();await lobby.getByRole('link',{name:/Choose a nickname/}).click();
 const nick='LinuxAudio'+crypto.randomBytes(3).toString('hex');await lobby.locator('[data-nick]').fill(nick);await lobby.locator('[data-enter]').click();await expect(lobby.locator('[data-connection]')).toHaveAttribute('data-state','connected');
 let response=await context.request.get(origin+'/beta/state');assert.equal(response.status(),200);const role=await response.json();await response.dispose();assert.equal(role.kind,'guest');assert.equal(role.role,'fan');proof.ordinaryGuestAdmission=true;
 const assets=Object.entries(supplied.assets).filter(([name])=>/^join\/.+\.(js|css|html)$/.test(name)||/\/lobby\/lobby\.(js|css)$/.test(name));assert.equal(assets.length,13);
 for(const [name,hash] of assets){response=await context.request.get(origin+'/'+name);assert.equal(response.status(),200);assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),hash);await response.dispose();}proof.runtimeAssetHashesMatched=13;
 await lobby.close();page=await context.newPage();page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{
  window.__nucToneProof={sources:[],peers:[],audioContexts:[],generatedCaptureRequests:0,displayCaptureRequests:0};
  const NativeAudio=window.AudioContext;window.AudioContext=new Proxy(NativeAudio,{construct(target,args,newTarget){const c=Reflect.construct(target,args,newTarget);window.__nucToneProof.audioContexts.push(c);return c;}});
  const Native=window.RTCPeerConnection;window.RTCPeerConnection=new Proxy(Native,{construct(target,args,newTarget){const pc=Reflect.construct(target,args,newTarget);window.__nucToneProof.peers.push(pc);return pc;}});
  const media=Object.getPrototypeOf(navigator.mediaDevices);
  Object.defineProperty(media,'getDisplayMedia',{configurable:true,value:async()=>{window.__nucToneProof.displayCaptureRequests++;throw new Error('Physical capture excluded');}});
  Object.defineProperty(media,'getUserMedia',{configurable:true,value:async()=>{
   window.__nucToneProof.generatedCaptureRequests++;const audio=new AudioContext({sampleRate:48000});await audio.resume();const tone=audio.createOscillator();tone.frequency.value=440;const gain=audio.createGain();gain.gain.value=.15;const dest=audio.createMediaStreamDestination();tone.connect(gain).connect(dest);tone.start();
   const track=dest.stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{stop();audio.close().catch(()=>{});};window.__nucToneProof.sources.push(dest.stream);return dest.stream;
  }});
  document.addEventListener('DOMContentLoaded',()=>{const audio=document.getElementById('host-audio');if(audio)audio.muted=true;},{once:true});
 });
 stage='normal browser invitation, synthetic mic check and real WebRTC join';await page.goto(supplied.invite,{timeout:15000});await expect(page.getByRole('heading',{name:'Check your audio',exact:true})).toBeVisible();
 let started=performance.now();await page.getByRole('button',{name:'Check microphone',exact:true}).click();await expect(page.locator('#mic-heard')).toBeVisible();proof.generatedMicDetectionMs=Math.round(performance.now()-started);
 await page.getByRole('checkbox').check();started=performance.now();await page.getByRole('button',{name:'Join with microphone',exact:true}).click();await page.waitForFunction(()=>window.__nucToneProof?.peers.at(-1)?.connectionState==='connected'&&document.getElementById('host-audio')?.srcObject,null,{timeout:45000});proof.connectFromJoinClickMs=Math.round(performance.now()-started);
 stage='actual connected browser access countdown and Leave focus';
 await expect(page.locator('#access-window')).toBeVisible();await expect(page.locator('#join')).toBeHidden();await expect(page.locator('#leave')).toBeFocused();
 const seconds=text=>{const m=text.match(/^Browser access ends in (\d+):(\d{2})\.$/);assert(m);return Number(m[1])*60+Number(m[2]);};
 const firstTime=performance.now(),firstSeconds=seconds(await page.locator('#access-time').textContent());assert(firstSeconds>60);
 await page.waitForTimeout(1200);const secondSeconds=seconds(await page.locator('#access-time').textContent());assert(secondSeconds<firstSeconds&&firstSeconds-secondSeconds<=3);
 proof.connectedAccessCountdown={firstSeconds,secondSeconds,elapsedMs:Math.round(performance.now()-firstTime),joinHidden:true,leaveFocused:true,clockOrTtlChanged:false};
 await page.screenshot({path:'.local/c227-generated-countdown-connected.png'});
 stage='measure actual generated transport and WAV chord bands for40seconds';proof.browser=await sample(page,40);assert(proof.browser.toneWindows>=80&&proof.browser.disconnectedWindows===0);assert(proof.browser.packetsSent>0&&proof.browser.packetsReceived>0);assert(Object.values(proof.browser.musicalWindows).every(windows=>windows>=3));
 stage='normal browser Leave and all stream/peer/context cleanup';await page.getByRole('button',{name:'Leave session',exact:true}).click();await expect(page.locator('#status')).toHaveText('You left the session.');await expect(page.locator('#access-window')).toBeHidden();proof.accessCountdownHiddenAfterLeave=true;
 await expect.poll(()=>page.evaluate(()=>{const p=window.__nucToneProof;return p.sources.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&p.peers.every(pc=>pc.connectionState==='closed')&&p.audioContexts.every(c=>c.state==='closed');}),{timeout:7000}).toBe(true);
 proof.generatedResourcesClosed=true;proof.fixtureCounts=await page.evaluate(()=>({generatedCaptureRequests:window.__nucToneProof.generatedCaptureRequests,displayCaptureRequests:window.__nucToneProof.displayCaptureRequests}));assert.equal(proof.fixtureCounts.displayCaptureRequests,0);
 replay=await browser.newContext({serviceWorkers:'block'});await replay.addCookies(await context.cookies(origin));response=await replay.request.get(origin+'/beta/state');assert.equal(response.status(),200);await response.dispose();proof.state='PASSED_GENERATED_LINUX_BROWSER_MEDIA_PENDING_NATIVE_AND_LOGOUT_READBACK';
}catch(error){proof.state='FAILED_PRESERVE_ORIGINAL_LINUX_GENERATED_TRIAL';proof.failureStage=stage;proof.failureType=error.name;proof.failureMessage=redact(error);}
finally{
 if(page&&!page.isClosed())await page.evaluate(()=>{for(const s of window.__nucToneProof?.sources??[])for(const t of s.getTracks())if(t.readyState==='live')t.stop();}).catch(()=>{});
 if(context)try{let r=await context.request.post(origin+'/beta/logout',{data:{},headers:{Origin:origin},timeout:12000});proof.logoutStatus=r.status();await r.dispose();r=await context.request.get(origin+'/beta/state');proof.originalAfterLogout=r.status();await r.dispose();if(replay){r=await replay.request.get(origin+'/beta/state');proof.copiedCookieAfterLogout=r.status();await r.dispose();}assert.equal(proof.logoutStatus,200);assert.equal(proof.originalAfterLogout,401);if(replay)assert.equal(proof.copiedCookieAfterLogout,401);}catch(error){proof.state='FAILED_LOGOUT_OR_REPLAY_CLEANUP';proof.cleanupFailureType=error.name;}
 const closed=[];for(const own of [replay,context,browser].filter(Boolean))try{await own.close();closed.push(true);}catch{closed.push(false);}clearTimeout(watchdog);proof.allOwnedBrowserResourcesClosed=closed.every(Boolean);if(!proof.allOwnedBrowserResourcesClosed)proof.state='FAILED_OWN_BROWSER_CLEANUP';proof.completedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(proof,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(proof));process.exitCode=proof.state==='PASSED_GENERATED_LINUX_BROWSER_MEDIA_PENDING_NATIVE_AND_LOGOUT_READBACK'?0:1;
}})();
