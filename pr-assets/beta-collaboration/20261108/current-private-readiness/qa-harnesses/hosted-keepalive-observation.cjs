'use strict';
// A NEW bounded post-update observation. Never replaces the original 8h test.
// No virtual clock, shortened TTL, media, user-content logs, or forced ping.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {webkit, expect} = require('@playwright/test');
const sdkVersion = require('@playwright/test/package.json').version;
assert.equal(sdkVersion, '1.64.1');
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'x64');
const supplied = JSON.parse(fs.readFileSync(0, 'utf8'));
const base = 'https://stalemate-hangout-beta.jeffstory007.workers.dev';
const file = '.local/hosted-heartbeat-observation-nov08.json';
const duration = 110 * 60 * 1000;
assert.equal(supplied.source, 'ac9b82f42c8d6952193f5cbefbf11fc04816821d');
assert.equal(supplied.originalExpiryTerminalAndIndependentlyVerified, true);
assert.equal(supplied.currentPrivateDeploymentAndSettingsVerified, true);
assert(supplied.version && supplied.version !== 'c2271048-aaa3-4649-8e9e-48dd46212da5');
assert(!fs.existsSync(file), 'Inspect this exact attempt; never replace or restart it');
const proof = {state:'STARTING', pid:process.pid, source:supplied.source, version:supplied.version,
  startedAt:new Date().toISOString(), endpoint:'Intel MacBook', engine:'SDK WebKit',
  sdkVersion, nodeVersion:process.version, platform:process.platform, architecture:process.arch,
  ordinaryGuests:1, durationRequestedMs:duration, realTime:true, clockOrTtlChanged:false,
  originalEightHourProofReplaced:false, physicalCapture:false, providerCredentials:false,
  recording:false, userContentRetained:false, resourceChecks:[], assetChecks:[], snapshots:[],
  scope:'Bounded actual hosted transport observation, not physical audio, native music, eight-hour uptime or production capacity.'};
let browser, context, page, stage='launch', stop=false, finished=false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const name of ['SIGTERM','SIGINT','SIGHUP']) process.on(name, () => { stop=true; });
function save() {
  proof.observedAt=new Date().toISOString();
  fs.writeFileSync(file+'.tmp', JSON.stringify(proof,null,2)+'\n', {mode:0o600});
  fs.renameSync(file+'.tmp',file);
  console.log(JSON.stringify({kind:'hosted-heartbeat-observation',...proof}));
}
function guard() {
  const raw=execFileSync('/usr/sbin/sysctl',['vm.swapusage'],{encoding:'utf8',timeout:5000});
  const swap=Object.fromEntries([...raw.matchAll(/(total|used|free) = ([0-9.]+)M/g)].map(x=>[x[1],Number(x[2])]));
  assert(Number.isFinite(swap.total)&&Number.isFinite(swap.used));
  const disk=fs.statfsSync(os.homedir());
  const row={at:new Date().toISOString(),load:os.loadavg()[0],swapPercent:swap.total?100*swap.used/swap.total:0,
    freeGiB:Math.round(disk.bavail*disk.bsize/2**30*100)/100};
  proof.resourceChecks.push(row);
  if(row.load>=10||row.swapPercent>=80||row.freeGiB<15) throw new Error('RESOURCE_GUARD_CLOSED');
}
async function snapshot() {
  return page.evaluate(()=>({at:Date.now(), connection:document.querySelector('[data-connection]')?.dataset.state,
    socketState:window.__lobby?.ws?.readyState, roleIsGuestFan:window.__lobby?.role==='fan',
    captureRequests:window.qaTransport.captureRequests, protocol:window.qaTransport}));
}
async function checkAssets() {
  for(const [name, expected] of Object.entries(supplied.assetHashes)) {
    assert(['r/45662413410ed051/lobby/lobby.js','r/45662413410ed051/lobby/idle-heartbeat.mjs',
      'join/app.js','join/audio.js','join/PROVENANCE.json'].includes(name));
    const response=await context.request.get(base+'/'+name,{timeout:15000});
    assert.equal(response.status(),200);
    assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),expected);
    proof.assetChecks.push({at:new Date().toISOString(),path:name,sha256:expected});
    await response.dispose();
  }
}
(async()=>{
  try {
    guard(); browser=await webkit.launch(); proof.browserVersion=browser.version();
    context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',permissions:[]});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.addInitScript(()=>{
      const qa=window.qaTransport={captureRequests:0,opens:[],closes:[],capabilities:[],pings:[],pongs:[],acks:0,receivedFrames:0};
      for(const method of ['getUserMedia','getDisplayMedia']) if(navigator.mediaDevices?.[method])
        navigator.mediaDevices[method]=async()=>{qa.captureRequests++;throw new Error('Physical capture excluded');};
      const Native=window.WebSocket;let serial=0;
      window.WebSocket=new Proxy(Native,{construct(target,args,newTarget){
        const ws=Reflect.construct(target,args,newTarget), generation=++serial;
        ws.addEventListener('open',()=>{if(qa.opens.length<32)qa.opens.push({at:Date.now(),generation});});
        ws.addEventListener('close',event=>{if(qa.closes.length<32)qa.closes.push({at:Date.now(),generation,code:event.code});});
        ws.addEventListener('message',event=>{
          qa.receivedFrames++;
          let value;try{value=JSON.parse(event.data);}catch{return;}
          if(value.t==='hello'&&qa.capabilities.length<32)qa.capabilities.push({at:Date.now(),generation,transportPing:value.features?.transportPing??null});
          if(value.t==='transport-pong'&&qa.pongs.length<64)qa.pongs.push({at:Date.now(),generation});
        });
        const send=ws.send.bind(ws);
        ws.send=value=>{
          let data;try{data=JSON.parse(value);}catch{}
          if(data?.t==='transport-ping'&&qa.pings.length<64)qa.pings.push({at:Date.now(),generation,keys:Object.keys(data).sort()});
          if(data?.t==='transport-ack')qa.acks++;
          return send(value);
        };
        return ws;
      }});
    });
    page=await context.newPage(); page.setDefaultTimeout(15000);
    stage='ordinary guest entry'; const entryStart=Date.now();
    await page.goto(base+'/beta/?via=stalemate',{timeout:20000});
    await page.getByLabel('Invitation code').fill(supplied.invite);
    await page.getByRole('button',{name:/Enter the community/}).click();
    await page.getByRole('link',{name:/Choose a nickname/}).click();
    await page.locator('[data-nick]').fill('QuietQA'+crypto.randomBytes(3).toString('hex'));
    await page.locator('[data-enter]').click();
    await expect(page.locator('[data-connection]')).toHaveAttribute('data-state','connected');
    proof.setupMs=Date.now()-entryStart;
    const access=(await context.cookies(base)).find(x=>x.name==='__Host-hangout-beta');assert(access);
    const claims=JSON.parse(Buffer.from(access.value.split('.')[0],'base64url').toString());
    assert.equal(claims.scope,'guest');assert(claims.exp>Date.now()+duration+60000);
    proof.accessExpiresAt=new Date(claims.exp).toISOString();
    await checkAssets();
    const first=await snapshot();assert.equal(first.protocol.capabilities[0]?.transportPing,1);
    assert(first.roleIsGuestFan);assert.equal(first.captureRequests,0);
    const started=Date.now();proof.observationStartedAt=new Date(started).toISOString();
    proof.observationEndsAt=new Date(started+duration).toISOString();
    proof.state='OBSERVING_REAL_HOSTED_KEEPALIVE';proof.snapshots.push(first);save();
    let nextGuard=started+300000,nextAsset=started+1800000;
    while(Date.now()<started+duration) {
      if(stop)throw new Error('REQUESTED_STOP');
      if(Date.now()>=nextGuard){guard();const row=await snapshot();proof.snapshots.push(row);assert.equal(row.captureRequests,0);save();nextGuard=Date.now()+300000;}
      if(Date.now()>=nextAsset){await checkAssets();nextAsset=Date.now()+1800000;}
      await pause(Math.min(15000,Math.max(1,started+duration-Date.now())));
    }
    stage='terminal transport readback';proof.lastSnapshot=await snapshot();
    const qa=proof.lastSnapshot.protocol;
    assert.equal(qa.captureRequests,0);assert.equal(proof.lastSnapshot.connection,'connected');
    assert.equal(proof.lastSnapshot.socketState,1);assert(proof.lastSnapshot.roleIsGuestFan);
    assert(qa.capabilities.every(x=>x.transportPing===1));
    assert(qa.pings.every(x=>JSON.stringify(x.keys)==='["t"]'));
    proof.observedDurationMs=Date.now()-started;
    proof.observedPingCount=qa.pings.length;proof.observedPongCount=qa.pongs.length;
    assert(qa.pongs.length<=qa.pings.length);
    proof.socketOpenCount=qa.opens.length;proof.socketCloseCount=qa.closes.length;
    proof.observedClosureCodes=qa.closes.map(x=>x.code);
    proof.state=qa.closes.length?'OBSERVED_TRANSPORT_INTERRUPTION_INSPECT_SAME_ATTEMPT':
      qa.pings.length>=2&&qa.pongs.length>=2?'PASSED_BOUNDED_HOSTED_KEEPALIVE_NO_OBSERVED_CLOSE':
      'QUIET_KEEPALIVE_INSUFFICIENT_OBSERVATION_NOT_A_PASS';
    finished=true;
  } catch(error) {
    proof.state=error.message==='RESOURCE_GUARD_CLOSED'?'STOPPED_RESOURCE_GUARD':stop?'STOPPED_BY_SIGNAL':'FAILED_INSPECT_SAME_ATTEMPT';
    proof.failureStage=stage;proof.failureType=error.name;
  } finally {
    stage='logout and owned cleanup';
    if(context){try{const r=await context.request.post(base+'/beta/logout',{headers:{Origin:base},data:{},timeout:12000});proof.logoutStatus=r.status();await r.dispose();}catch{proof.logoutStatus='unconfirmed';}}
    if(page&&!page.isClosed())try{proof.afterLogoutSnapshot=await snapshot();}catch{}
    const closed=[];
    for(const owned of [context,browser].filter(Boolean)){try{await owned.close();closed.push(true);}catch{closed.push(false);}}
    proof.allOwnedBrowserResourcesClosed=closed.every(Boolean);
    if(proof.logoutStatus!==200||!proof.allOwnedBrowserResourcesClosed){proof.state='FAILED_CLEANUP_INSPECT_SAME_ATTEMPT';finished=false;}
    supplied.invite=null;proof.observerFinished=true;proof.completedAt=new Date().toISOString();save();
    process.exitCode=finished&&proof.state==='PASSED_BOUNDED_HOSTED_KEEPALIVE_NO_OBSERVED_CLOSE'?0:1;
  }
})();
