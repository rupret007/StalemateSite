/* Real-browser regression matrix. Run npm run test:mobile (Chromium installed). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const vendored = fs.existsSync(path.join(root, 'play/turdjack.html'));
const { chromium, webkit } = require(vendored ? '@playwright/test' : 'playwright');
const prefix = vendored ? '/play/' : '/';
const repo = vendored ? 'StalemateSite' : 'Turdanoid';
const sizes = [[360,640],[375,667],[390,844],[430,932],[667,375],[844,390]];
const games = {
  turdjack: { start:'#quickGuideBtn', controls:['#mobilePit [data-mobile-action]','#mobileFeltChipRack button','.mobile-menu summary'], area:'.table-stage' },
  TurdAnoid: { start:'#btnStart', controls:['#btnPause','#btnSound'], area:'#game' },
  turdtris: { start:'button:has-text("Quick Start")', controls:['#mobileControls button','.mobile-menu summary'], area:'#game' },
  crapeights: { start:'#quickStartBtn', controls:['#playBtn','#drawBtn','#passBtn','#smartBtn','#drawPileBtn','#playerHand button:not([hidden])'], area:'#playerHand' },
  turdrummy: { start:'#startRoundBtn', controls:['.action-grid button','#soundToggleBtn','#difficultyBtn','#quickGuideBtn','#playerHand button'], area:'.table' },
  turdspades: { start:'#quickStart', controls:['#lockBid','#bidDown','#bidUp','#bidNil','#playBtn','#sortSuit','#sortRank','#nextRoundDock','#youCards button'], area:'.table-arena' },
  turdomania: { controls:['#undoBtn','#newBtn','.suite-difficulty-btn'], area:'#board' },
  'neon-arkanoid': { start:'button:has-text("Quick Start")', controls:['#mobileControls button','.mobile-menu summary'], area:'#gameCanvas' }
};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.m4a':'audio/mp4','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);});
});
async function bounds(page, selector, label, target=false) {
  for(const el of await page.locator(selector).all()) {
    if(!await el.isVisible()) continue;
    const r=await el.boundingBox(); const v=page.viewportSize();
    assert(r,`${label}: ${selector} changed during measurement`);
    assert(r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,`${label}: ${selector} outside ${JSON.stringify(r)}`);
    const clipped=await el.evaluate(e=>{const r=e.getBoundingClientRect();for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p),a=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(c.overflowY)&& (r.top<a.top-1||r.bottom>a.bottom+1))return p.id||p.className;if(/hidden|clip|auto|scroll/.test(c.overflowX)&&(r.left<a.left-1||r.right>a.right+1))return p.id||p.className;}return '';});
    assert(!clipped,`${label}: ${selector} clipped by ${clipped}`);
    if(target) assert(r.width>=43.9&&r.height>=43.9,`${label}: ${selector} target below 44px: ${JSON.stringify(r)}`);
    // A fitting document must not hide its key controls behind another layer.
    if(target && await el.isEnabled()) {
      assert(await el.evaluate(e=>{const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===top||e.contains(top);}),`${label}: ${selector} covered (${await el.getAttribute('aria-label') || await el.textContent()})`);
    }
  }
}
async function check(page, game, label) {
  // Crapjack may offer insurance or even money immediately after a random deal.
  const decline=page.locator('#jackConfirmNo');
  if(game==='turdjack' && await decline.isVisible()) {
    await bounds(page,'#jackConfirmNo, #jackConfirmYes',`${label} decision`,true);
    await decline.click(); await page.waitForTimeout(150);
  }
  const metrics=await page.evaluate(()=>({h:document.scrollingElement.scrollHeight,w:document.scrollingElement.scrollWidth,ih:innerHeight,iw:innerWidth}));
  assert(metrics.h<=metrics.ih+1&&metrics.w<=metrics.iw+1,`${label}: document scrolls ${JSON.stringify(metrics)}`);
  assert(await page.locator(games[game].area).isVisible(), `${label}: play area hidden`);
  await bounds(page,games[game].area,label);
  for(const s of games[game].controls) await bounds(page,s,label,true);
  if(await page.locator('#suite-music-toggle').count()) await bounds(page,'#suite-music-toggle',label,true);
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await (process.env.MOBILE_BROWSER==='webkit'?webkit:chromium).launch();
 const base=`http://127.0.0.1:${server.address().port}${prefix}`;
 const results=[];
 try {
 for(const [game,config] of Object.entries(games)) {
  if(process.env.MOBILE_GAMES && !process.env.MOBILE_GAMES.split(',').includes(game)) continue;
  const failures=[];
  for(const [width,height] of sizes) {
   const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
   const page=await context.newPage(); const label=`${game} ${width}x${height}`;
   try {
    await page.goto(`${base}${game}.html`); await page.waitForTimeout(350);
    // Check the entry document before dismissing the first-run UI.
    const dims=await page.evaluate(()=>[document.scrollingElement.scrollHeight,innerHeight,document.scrollingElement.scrollWidth,innerWidth]);
    assert(dims[0]<=dims[1]+1&&dims[2]<=dims[3]+1,`${label}: entry scrolls ${dims}`);
    if(config.start){const start=page.locator(config.start).first();if(await start.isVisible())await start.click();}
    for(let i=0;i<5;i++){const coach=page.locator('#btnCoachNext');if(await coach.isVisible())await coach.click();}
    const skip=page.locator('#coachSkipBtn');if(await skip.isVisible())await skip.click();
    if(game==='turdrummy') await page.locator('#playerHand button').first().waitFor({state:'visible'});
    await page.waitForTimeout(game==='turdjack'?2000:350);
    await check(page,game,label);
    if(width===390&&process.env.MOBILE_SHOTS){fs.mkdirSync(process.env.MOBILE_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.MOBILE_SHOTS,`${repo}-${game}-after.png`)});}
    if(game==='crapeights' && width===390) {
      await page.evaluate(()=>{globalThis.__mobileSavedHand=players[0].hand;players[0].hand=buildDeck().slice(0,30);renderPlayerHand();});
      await page.waitForTimeout(100);
      const seen=new Set();
      for(let i=0;i<10;i++) {
        await check(page,game,`${label} growing hand`);
        await bounds(page,'.mobile-hand-pages button',`${label} hand pages`,true);
        for(const id of await page.locator('#playerHand button:not([hidden])').evaluateAll(cards=>cards.map(c=>c.dataset.cardId))) seen.add(id);
        const next=page.getByRole('button',{name:'Next cards',exact:true});
        if(await next.isDisabled()) break;
        await next.click();
      }
      assert.equal(seen.size,30,`${label}: every card remains reachable`);
      await page.evaluate(()=>{players[0].hand=globalThis.__mobileSavedHand;delete globalThis.__mobileSavedHand;renderPlayerHand();});
    }
    if(game==='turdspades' && await page.locator('#lockBid').isVisible()) {
      await page.locator('#lockBid').click();
      await page.waitForFunction(()=>document.body.dataset.turn==='you');
      await page.waitForTimeout(250);
      await check(page,game,`${label} after bidding`);
    }
    const menu=page.locator('.mobile-menu summary, #tsTableMenu > summary').first();
    if(await menu.isVisible()) {
      await menu.click();
      const overflow=await page.evaluate(()=>document.scrollingElement.scrollHeight>innerHeight+1||document.scrollingElement.scrollWidth>innerWidth+1);
      assert(!overflow,`${label}: opening menu scrolls document`);
      await menu.click();
    }
    // Rotate the same running game; check layout after returning too.
    await page.setViewportSize({width:height,height:width}); await page.waitForTimeout(200);
    if(height<=980) await check(page,game,`${label} rotated`);
    await page.setViewportSize({width,height}); await page.waitForTimeout(200); await check(page,game,`${label} restored`);
    console.log(`PASS ${label}`);
   } catch(error){failures.push(error.message);console.error(`FAIL ${error.message}`);await page.screenshot({path:`/tmp/mobile-fit-${repo}-${game}-${width}x${height}.png`}).catch(()=>{});}
   finally{await context.close();}
  }
  results.push({game,pass:failures.length===0,failures});
 }
 if(process.env.MOBILE_RESULTS)fs.writeFileSync(process.env.MOBILE_RESULTS,JSON.stringify(results,null,2)+'\n');
 assert(results.every(r=>r.pass),'Mobile fit failures (see per-game output).');
 } finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
