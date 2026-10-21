const {chromium,devices}=require('@playwright/test');
const fs=require('node:fs');
const out=__dirname;
const base=process.env.STALEMATE_CAPTURE_BASE || 'http://127.0.0.1:4320/StalemateSite/';
(async()=>{
 const browser=await chromium.launch();const errors=[];
 async function pageFor(size){const context=await browser.newContext({...size,reducedMotion:'reduce'});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-10-21T18:00:00Z'));return p;}
 const desktop=await pageFor({viewport:{width:1280,height:900}});await desktop.goto(base+'play/');await desktop.screenshot({path:out+'/hub-desktop.png',fullPage:true});
 const phone=await pageFor({viewport:{width:375,height:667},isMobile:true,hasTouch:true});await phone.goto(base+'play/');await phone.screenshot({path:out+'/hub-phone.png',fullPage:true});
 await phone.goto(base+'play/turdomania.html?daily=2026-10-21&v=1&reducedMotion=1');await phone.waitForFunction(()=>!!window.__turdomania);await phone.screenshot({path:out+'/daily-phone.png'});
 await phone.setViewportSize({width:667,height:375});await phone.screenshot({path:out+'/daily-landscape.png'});
 await phone.setViewportSize({width:375,height:667});
 for(let n=0;n<40;n++){const move=await phone.evaluate(()=>{const{state,Core}=window.__turdomania;for(let c=0;c<state.board.length;c++)for(let r=0;r<state.board[c].length;r++)if(Core.findGroup(state.board,c,r).length>=2)return[c,r];return null});if(!move)break;await phone.locator(`.tile[data-col="${move[0]}"][data-row="${move[1]}"]`).click();}
 await phone.screenshot({path:out+'/daily-result-phone.png'});
 await phone.goto(base+'play/TurdAnoid.html');await phone.locator('#btnStart').click();await phone.locator('#mobileLaunch').click({timeout:1500}).catch(()=>{});await phone.waitForTimeout(300);await phone.screenshot({path:out+'/turdanoid-phone.png'});
 for(const [file,start] of [['turdtris','button:has-text("Quick Start")'],['turdjack','#quickGuideBtn'],['crapeights','#quickStartBtn'],['turdrummy','#startRoundBtn'],['turdspades','#quickStart']]){
  await phone.goto(base+'play/'+file+'.html');const action=phone.locator(start).first();if(await action.isVisible())await action.click();const skip=phone.locator('#coachSkipBtn');if(await skip.isVisible())await skip.click();await phone.waitForTimeout(500);await phone.screenshot({path:out+'/'+file+'-phone.png'});
 }
 fs.writeFileSync(out+'/capture.json',JSON.stringify({date:'2026-10-21',browser:'Chromium desktop + emulated touch viewport; not physical-phone acceptance',upstream:'4dc8730f5bce149c71c5708a1e0996cb0ce2ec0b',errors},null,2)+'\n');
 await browser.close();if(errors.length)throw new Error(errors.join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1});
