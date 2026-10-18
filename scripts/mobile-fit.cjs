/* Run with npm run test:mobile. Optional MOBILE_SHOTS saves 390x844 evidence. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const prefix = fs.existsSync(path.join(root, 'play')) ? 'play/' : '';
const viewports = [[360,640],[375,667],[390,844],[430,932],[667,375],[844,390]];
const games = [
  ['turdjack', '.mobile-felt-chip-rack [data-chip="10"]', '[data-mobile-action="deal"]', '[data-mobile-action="hit"]', '[data-mobile-action="stand"]', '[data-mobile-action="double"]', '[data-mobile-action="split"]', '[data-mobile-action="surrender"]'],
  ['TurdAnoid', '#game', '#btnPause', '#btnSound', '#mobileLaunch'],
  ['turdtris', '#game', '#mobileControls [data-action="left"]', '#mobileControls [data-action="right"]', '#mobileControls [data-action="rotate"]', '#mobileControls [data-action="drop"]', '#mobileControls [data-action="hold"]'],
  ['crapeights', '#drawPileBtn', '#playBtn', '#drawBtn', '#passBtn', '#smartBtn'],
  ['turdrummy', '#playerHand', '#soundToggleBtn', '#quickGuideBtn', '#newRoundBtn', '#resetMatchBtn', '#drawStockBtn', '#drawDiscardBtn', '#discardBtn', '#knockBtn', '#ginBtn', '#sortSuitBtn', '#sortRankBtn'],
  ['turdspades', '#youCards', '#bidDown', '#bidUp', '#bidNil', '#lockBid'],
  ['turdomania', '#board', '#undoBtn', '#newBtn', '.tm-aim summary'],
  ['neon-arkanoid', '#gameCanvas', '[data-action="left"]', '[data-action="launch"]', '[data-action="right"]']
];
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.m4a':'audio/mp4','.png':'image/png'};
const server = http.createServer((req,res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error,data) => { if(error) res.writeHead(404).end(); else {res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');res.end(data);} });
});
async function tap(page, locator) {
  await locator.waitFor({state:'visible'});
  const element = await locator.elementHandle();
  await page.waitForFunction(e => !e.disabled, element);
  const box = await locator.boundingBox();
  assert(box && box.width >= 44 && box.height >= 44, 'tap target is at least 44px');
  const viewport = page.viewportSize();
  assert(box.x >= -1 && box.y >= -1 && box.x+box.width <= viewport.width+1 && box.y+box.height <= viewport.height+1, 'tap target is fully on screen');
  assert(await locator.evaluate(e => {const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit);}), 'tap target receives touch');
  await page.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
}
async function clickVisible(page, selector) {
  const locator = page.locator(selector).first();
  if (await locator.isVisible()) await tap(page, locator);
}
async function enter(page, game) {
  if(game === 'turdjack') await clickVisible(page, '#closeGuideBtn');
  if(game === 'TurdAnoid') { await tap(page, page.locator('#btnStart')); await clickVisible(page, '#btnCoachNext'); await clickVisible(page, '#btnCoachNext'); await clickVisible(page, '#btnCoachNext'); }
  if(game === 'turdtris') await clickVisible(page, '[onclick="quickStartRun()"]');
  if(game === 'crapeights') await clickVisible(page, '#closeGuideBtn');
  if(game === 'turdrummy') await clickVisible(page, '#startRoundBtn');
  if(game === 'turdspades') await clickVisible(page, '#quickStart');
  if(game === 'neon-arkanoid') await clickVisible(page, '#howToPlay .guide-actions button:last-child');
  await page.waitForTimeout(300);
  if(game === 'turdrummy') {
    await page.locator('#playerHand button').first().waitFor();
    await clickVisible(page, '#coachSkipBtn');
  }
}
async function check(page, game, selectors, state) {
  const metrics = await page.evaluate(() => ({w:innerWidth,h:innerHeight,sw:document.scrollingElement.scrollWidth,sh:document.scrollingElement.scrollHeight}));
  assert(metrics.sh <= metrics.h + 1, `${game} ${state} document height ${JSON.stringify(metrics)}`);
  assert(metrics.sw <= metrics.w + 1, `${game} ${state} document width ${JSON.stringify(metrics)}`);
  for(const selector of selectors) {
    const locator = page.locator(selector).first();
    assert(await locator.isVisible(), `${game} ${state}: ${selector} visible`);
    const box = await locator.boundingBox();
    assert(box && box.width > 0 && box.height > 0 && box.x >= -1 && box.y >= -1 && box.x + box.width <= metrics.w+1 && box.y + box.height <= metrics.h+1, `${game} ${state} ${selector}: ${JSON.stringify(box)} in ${metrics.w}x${metrics.h}`);
    if(await locator.evaluate(e => e.matches('button,summary,select'))) {
      assert(box.width >= 43.9 && box.height >= 43.9, `${game} ${selector} touch target ${box.width}x${box.height}`);
      // Detect fixed chrome or another control covering the centre, even for disabled actions.
      if(await locator.isEnabled()) assert(await locator.evaluate(e => { const b=e.getBoundingClientRect(); const top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return top===e || e.contains(top); }), `${game} ${state} ${selector} is covered: ${await locator.evaluate(e => {const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,200);})}`);
    }
  }
  const cards = await page.locator('.mobile-hand button:not(.mobile-card-hidden), .mobile-hand .card:not(.mobile-card-hidden)').evaluateAll(elements => elements.filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 0).map(e => {
    const b = e.getBoundingClientRect();
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { x:b.x, y:b.y, width:b.width, height:b.height, disabled:e.tagName !== 'BUTTON' || e.disabled, covered:top !== e && !e.contains(top) };
  }));
  for (const box of cards) {
    assert(box.width >= 44 && box.height >= 44 && box.y >= -1 && box.x >= -1 && box.y + box.height <= metrics.h+1 && box.x + box.width <= metrics.w+1, `${game} ${state} card target fits: ${JSON.stringify(box)}`);
    if (!box.disabled) assert(!box.covered, `${game} ${state} card covered`);
  }
  // Overflow-hidden alone cannot satisfy the test: the whole board must also fit.
  if(['turdtris','neon-arkanoid'].includes(game)) {
    const box = await page.locator(game==='turdtris'?'#game':'#gameCanvas').boundingBox();
    assert(Math.abs(box.width / box.height - (game==='turdtris'?0.5:1.5)) < .01, `${game} canvas aspect ratio`);
  }
  const offset = await page.evaluate(() => { window.scrollTo(100,100); return [scrollX,scrollY]; });
  assert.deepEqual(offset,[0,0], `${game} ${state} scroll locked`);
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const engine = process.env.MOBILE_BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  let failures = 0;
  try {
    for(const [width,height] of viewports.filter(v=>!process.env.MOBILE_VIEWPORT || v.join('x')===process.env.MOBILE_VIEWPORT)) for(const [game,...selectors] of games.filter(g=>!process.env.MOBILE_GAME || g[0]===process.env.MOBILE_GAME)) {
      const context = await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
      await context.addInitScript(()=>localStorage.setItem('turdanoid_v3_coach_v1','1'));
      const page=await context.newPage(); page.setDefaultTimeout(10000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/${prefix}${game}.html`, {waitUntil:'domcontentloaded'});
        await page.waitForTimeout(350);
        const welcome = await page.locator('#welcomeGuide button, #guideOverlay button, #guide button, #howToPlay button, #titleScreen button').evaluateAll(elements => elements.filter(e => e.checkVisibility()).map(e => ({name:e.id || e.textContent.trim(), box:e.getBoundingClientRect().toJSON()})));
        for (const {name,box} of welcome) assert(box.x >= -1 && box.y >= -1 && box.right <= width+1 && box.bottom <= height+1, `${game} welcome ${name} fits: ${JSON.stringify(box)}`);
        await enter(page,game);
        await check(page,game,selectors, 'ready');
        if(game==='turdjack') {
          await tap(page, page.locator('.mobile-felt-chip-rack [data-chip="10"]'));
          await tap(page, page.locator('[data-mobile-action="deal"]'));
          await page.waitForTimeout(650);
          if(await page.locator('#jackConfirmNo').isVisible()) {
            await check(page,game,['#jackConfirmYes','#jackConfirmNo'],'insurance decision');
            await tap(page, page.locator('#jackConfirmNo'));
          }
          await check(page,game,selectors,'dealt');
          if(await page.locator('[data-mobile-action="stand"]').isEnabled()) await tap(page, page.locator('[data-mobile-action="stand"]'));
          await page.waitForTimeout(1200);
          await check(page,game,selectors,'resolved');
        }
        if(['crapeights','turdrummy','turdspades'].includes(game)) {
          const hand=page.locator(game==='turdspades'?'#youCards':'#playerHand');
          assert(await hand.locator('button').count()>0,`${game} has a dealt hand`);
          const next=page.getByRole('button',{name:'Next cards',exact:true});
          if(await next.isVisible() && await next.isEnabled()) {
            const before=await hand.locator('button:not(.mobile-card-hidden)').first().getAttribute('data-card-id');
            await tap(page, next);await check(page,game,selectors,'next hand page');
            if(before!==null) assert.notEqual(await hand.locator('button:not(.mobile-card-hidden)').first().getAttribute('data-card-id'),before);
            await tap(page, page.getByRole('button',{name:'Previous cards',exact:true}));
          }
          if(game==='turdrummy') {
            await tap(page, page.locator('#drawStockBtn'));await page.waitForTimeout(250);
            await tap(page, hand.locator('button:not(.mobile-card-hidden)').first());
            await tap(page, page.locator('#discardBtn'));await page.waitForTimeout(250);
            await check(page,game,selectors,'draw and discard');
          }
          if(game==='turdspades') {
            await tap(page, page.locator('#lockBid'));await page.waitForTimeout(250);
            await check(page,game,['#youCards','#playBtn','#sortSuit','#sortRank'],'bid locked');
          }
        }
        if(game==='turdomania') {
          await tap(page, page.locator('.tm-aim summary'));
          await check(page,game,[...selectors,'[data-board-key="ArrowLeft"]','[data-board-key="ArrowRight"]','[data-board-key="ArrowUp"]','[data-board-key="ArrowDown"]','[data-board-key="Enter"]'],'precision controls');
          await tap(page, page.getByRole('button',{name:'Aim right',exact:true}));
          assert.equal(await page.locator('#board .cursor').count(),1,'precision arrows select a real cell');
          await tap(page, page.locator('.tm-aim summary'));
        }
        if(process.env.MOBILE_SHOTS && width===390 && height===844) {
          fs.mkdirSync(process.env.MOBILE_SHOTS,{recursive:true});
          await page.screenshot({path:path.join(process.env.MOBILE_SHOTS,`${prefix?'site':'turd'}-${game}-after.png`)});
        }
        // Rotate a live session both ways, without navigation or resetting state.
        if(width===390 && height===844) {
          await page.setViewportSize({width:844,height:390});await page.waitForTimeout(250);
          const rotated = game==='turdspades'?['#youCards','#playBtn','#sortSuit','#sortRank']:selectors;
          await check(page,game,rotated,'rotated landscape');
          await page.setViewportSize({width,height});await page.waitForTimeout(250);
          await check(page,game,rotated,'rotated portrait');
        }
        assert.deepEqual(errors,[],`${game} page errors`);
        console.log(`PASS ${game} ${width}x${height}`);
      }catch(error){failures++; console.error(`FAIL ${game} ${width}x${height}: ${error.message}`);if(errors.length) console.error(errors);fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,`test-results/mobile-${game}-${width}x${height}.png`)}).catch(()=>{});}
      await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
  assert.equal(failures,0,`${failures} mobile cases failed`);
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
