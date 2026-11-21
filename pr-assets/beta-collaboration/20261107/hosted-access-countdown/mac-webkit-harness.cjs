'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium, webkit, expect } = require('@playwright/test');
const root = process.cwd(), base = 'https://stalemate-hangout-beta.jeffstory007.workers.dev';
const engineName = process.argv[2];
assert.ok(['chromium', 'webkit'].includes(engineName));
const output = path.join(root, '.local/direct-hosted-candidate-' + engineName + '-c227104-nov07.json');
assert.ok(!fs.existsSync(output), 'Retain earlier attempts');
const supplied = JSON.parse(fs.readFileSync(0, 'utf8'));
const post = supplied.post;
assert.equal(post.passed, true);
const manifest = supplied.manifest;
const invite = supplied.invite;
assert.ok(typeof invite === 'string' && invite.length >= 32);
const result = { source: manifest.candidateSource, activeVersion: post.activeVersion, engine: engineName,
  scope: 'Actual invitation-protected Cloudflare service; isolated synthetic guests, no live media, provider credentials, signed identity fixtures, or human moderation.',
  startedAt: new Date().toISOString(), checks: [], captureRequests: 0, assets: [], logout: [] };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entrants = [];
let browser, currentStage = 'launch';
const stage = async (name, action) => { currentStage = name; await action(); result.checks.push(name); console.log(name); };
const suffix = crypto.randomBytes(3).toString('hex');
const send = async (p, value) => { await p.locator('[data-text]').fill(value); await p.locator('[data-text]').press('Enter'); };
(async () => {
  try {
    browser = await (engineName === 'chromium' ? chromium : webkit).launch();
    result.browserVersion = browser.version(); result.executionEndpoint = 'Intel MacBook macOS 15.7.9';
    const anonymous = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await stage('Uninvited guests cannot read private state or Web Join JavaScript', async () => {
        for (const resource of ['/beta/state', '/join/app.js']) {
          const r = await anonymous.request.get(base + resource, { timeout: 20000 });
          assert.equal(r.status(), 401); await r.dispose();
        }
      });
    } finally { await anonymous.close(); }
    const early = 'Before the other guest joined ' + suffix;
    for (const [site, label, name, width] of [
      ['stalemate', 'Stalemate', 'StageA' + suffix, 1280], ['rad-dad', 'Rad Dad', 'StageB' + suffix, 390],
    ]) await stage(label + ' invitation, nickname and connected chat', async () => {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const entrant = { context, name, site, loggedOut: false }; entrants.push(entrant);
      await context.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
      await context.addInitScript(() => {
        window.qaCaptureRequests = 0;
        for (const method of ['getUserMedia','getDisplayMedia']) if (navigator.mediaDevices?.[method]) navigator.mediaDevices[method] = async () => { window.qaCaptureRequests++; throw new Error('Live media excluded from this check'); };
      });
      const page = await context.newPage(); entrant.page = page; page.setDefaultTimeout(20000);
      await page.goto(base + '/beta/?via=' + site);
      await page.getByLabel('Invitation code').fill(invite);
      const start = performance.now();
      await page.getByRole('button', { name: /Enter the community/ }).click();
      await page.getByRole('link', { name: /Choose a nickname/ }).click();
      await expect(page.locator('[data-entry-label]').first()).toHaveText('via ' + label);
      await page.locator('[data-nick]').fill(name); await page.locator('[data-enter]').click();
      await expect(page.locator('[data-connection]')).toHaveAttribute('data-state', 'connected');
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('log',{name:'Conversation'}).getByRole('list',{name:'Messages'})).toBeVisible();
      entrant.setupMs = Math.round(performance.now() - start);
      if (site === 'stalemate') { await send(page, early); await expect(page.locator('[data-buffer]')).toContainText(early); }
      else await expect(page.locator('[data-buffer]')).not.toContainText(early);
    });
    const [a,b] = entrants;
    await stage('Both entrances share one lobby and display the arrival-site badge', async () => {
      const line = 'Hello from the Rad Dad entrance ' + suffix;
      await send(b.page, line);
      await expect(a.page.locator('[data-buffer] li').filter({ hasText: line })).toContainText('via Rad Dad');
      await expect(b.page.locator('[data-buffer]')).toContainText(line);
    });
    await stage('Private runtime JavaScript and styles match the candidate exactly', async () => {
      const names = Object.keys(manifest.assetSha256).filter(p => /^join\/.+\.(js|css|html)$/.test(p) || /\/lobby\/lobby\.(js|css)$/.test(p));
      assert.equal(names.length, 13);
      for (const resource of names) {
        const r = await a.context.request.get(base + '/' + resource, { timeout: 20000 });
        assert.equal(r.status(), 200, resource);
        assert.equal(sha(await r.body()), manifest.assetSha256[resource], resource);
        result.assets.push(resource); await r.dispose();
      }
    });
    await stage('Mobile chat contains page width and keeps input and Send visible at 375 and 390px', async () => {
      result.mobile = [];
      for (const width of [375,390]) {
        await b.page.setViewportSize({ width, height: 844 });
        const measured = await b.page.evaluate(() => {
          const input = document.querySelector('[data-text]'), send = document.querySelector('[data-say] button[type=submit]');
          const a = input.getBoundingClientRect(), b = send.getBoundingClientRect();
          return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, inputLeft: a.left, inputRight: a.right,
            sendRight: b.right, sendLeft: b.left, fontSize: getComputedStyle(input).fontSize };
        });
        assert.ok(measured.pageWidth <= width && measured.inputLeft >= 0 && measured.inputRight <= width && measured.sendLeft >= 0 && measured.sendRight <= width);
        assert.equal(measured.fontSize, '16px'); result.mobile.push(measured);
        await b.page.screenshot({ path: path.join(root, '.local/hosted-' + engineName + '-' + width + '-c227104-nov07.png') });
      }
    });
    await stage('Manual reconnect retains an unsent draft and starts fresh scrollback', async () => {
      const draft = 'Unsent draft ' + suffix;
      await b.page.locator('[data-text]').fill(draft);
      await b.page.evaluate(() => window.__lobby.ws.close(1000));
      await expect(b.page.locator('[data-connection]')).toHaveAttribute('data-state','offline');
      const start = performance.now();
      await b.page.locator('[data-reconnect]').click();
      await expect(b.page.locator('[data-connection]')).toHaveAttribute('data-state','connected');
      result.reconnectMs = Math.round(performance.now() - start);
      await expect(b.page.locator('[data-text]')).toHaveValue(draft);
      await expect(b.page.locator('[data-buffer]')).not.toContainText(early);
      await expect(a.page.locator('[data-buffer]')).not.toContainText(draft);
      await b.page.locator('[data-text]').fill('');
      const line = 'After reconnect ' + suffix;
      result.reconnectSenderState = await a.page.evaluate(() => ({
        modes: window.__lobby.chans.get('#stalemate')?.modes,
        connection: document.querySelector('[data-connection]').dataset.state,
        budget: window.__lobby.budget, lock: window.__lobby.netLock,
      }));
      await a.page.waitForTimeout(3200);
      await send(a.page,line);
      try { await expect(a.page.locator('[data-buffer]')).toContainText(line); }
      catch (error) {
        result.senderRecovery = await a.page.evaluate(() => ({
          slowModeNotice: document.querySelector('[data-buffer]').textContent.match(/Slow mode: one line every [0-9]+s\./g),
          speedNotice: document.querySelector('[data-buffer]').textContent.includes('speed racer'),
          readOnly: document.querySelector('[data-buffer]').textContent.includes('read-only'),
          muted: document.querySelector('[data-buffer]').textContent.includes('muted for now'),
          inputPresent: document.querySelector('[data-text]').value.length > 0,
        }));
        throw error;
      }
      await expect(b.page.locator('[data-buffer]')).toContainText(line);
    });
    await stage('Two guests create and join an Art room with a received canvas stroke', async () => {
      await a.page.locator('[data-start=art]').click();
      await expect(a.page.locator('[data-act-canvas]')).toBeVisible();
      const room = await a.page.evaluate(() => window.__lobby.active); a.ownedRoom = room;
      await b.page.locator('nav [data-show=rooms]').click();
      await b.page.locator('[data-roomlist] button.room').filter({ hasText: room }).click();
      await b.page.locator('nav [data-show=chat]').click();
      await expect(b.page.locator('[data-act-canvas]')).toBeVisible();
      const bounds = await a.page.locator('[data-act-canvas]').boundingBox();
      await a.page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.3);
      await a.page.mouse.down(); await a.page.mouse.move(bounds.x+bounds.width*.55,bounds.y+bounds.height*.55,{steps:5}); await a.page.mouse.up();
      await expect.poll(() => b.page.evaluate(() => window.__lobbyRoom.state.room.strokes.length)).toBeGreaterThan(0);
    });
    await stage('The server allows the room host and refuses an ordinary guest topic change', async () => {
      const topic = 'Private candidate QA ' + suffix;
      await send(a.page,'/topic '+topic); await expect(b.page.locator('[data-topic]')).toHaveText(topic);
      await send(b.page,'/topic Guest must not control this');
      await expect(b.page.locator('[data-buffer]')).toContainText('only @ can set the topic');
      await expect(a.page.locator('[data-topic]')).toHaveText(topic);
    });
    await stage('A Jam host can invite a guest and share a browser destination on the preserved origin', async () => {
      await b.page.locator('nav [data-show=rooms]').click(); await b.page.locator('[data-start=jam]').click();
      await b.page.locator('nav [data-show=chat]').click(); await expect(b.page.locator('[data-jam]')).toBeVisible();
      b.ownedRoom = await b.page.evaluate(() => window.__lobby.active);
      await b.page.evaluate(name => window.__lobby.cmd('invite',[name]),a.name);
      await a.page.locator('[data-toast]').getByRole('button',{name:'Join',exact:true}).click();
      await expect(a.page.locator('[data-jam]')).toBeVisible();
      await b.page.locator('[data-jam-link]').fill(base+'/join/#qa-inert-destination-'+suffix);
      await b.page.locator('[data-jam-form] button[type=submit]').click();
      await expect(b.page.locator('[data-jam-link]')).toHaveValue('');
      await expect(a.page.locator('[data-jam-web]')).toBeEnabled();
      await expect(b.page.locator('[data-jam-web]')).toBeEnabled();
      result.browserInvitationShared = true;
    });
    await stage('Both own QA rooms close through the normal host command', async () => {
      for (const guest of entrants) {
        assert.ok(guest.ownedRoom);
        await guest.page.evaluate(room => window.__lobby.cmd('close',[],room),guest.ownedRoom);
        await expect.poll(() => guest.page.evaluate(room => window.__lobby.chans.has(room),guest.ownedRoom)).toBe(false);
      }
    });
    await stage('Logout revokes copied cookies and protected code and closes the active page', async () => {
      for (const guest of entrants) {
        const copied = await browser.newContext({ serviceWorkers:'block' });
        try {
          await copied.addCookies(await guest.context.cookies(base));
          let r = await copied.request.get(base+'/beta/state'); assert.equal(r.status(),200); await r.dispose();
          r = await guest.context.request.post(base+'/beta/logout',{headers:{Origin:base},data:{}});
          assert.equal(r.status(),200); guest.loggedOut=true; result.logout.push(200); await r.dispose();
          r = await copied.request.get(base+'/beta/state'); assert.equal(r.status(),401); await r.dispose();
          r = await guest.context.request.get(base+'/join/app.js'); assert.equal(r.status(),401); await r.dispose();
          await expect(guest.page.locator('[data-session-ended]')).toBeVisible();
          result.captureRequests += await guest.page.evaluate(() => window.qaCaptureRequests);
        } finally { await copied.close(); }
      }
      assert.equal(result.captureRequests,0);
    });
    result.setupMs = entrants.map(x=>({source:x.site,ms:x.setupMs})); result.status='passed';
  } catch(error) { result.status='failed'; result.failure={stage:currentStage,type:error.name,message:String(error.message).replaceAll(invite,'[redacted]').slice(0,1600)}; }
  finally {
    for(const guest of entrants) {
      if(!guest.loggedOut) {
        try { const r=await guest.context.request.post(base+'/beta/logout',{headers:{Origin:base},data:{},timeout:12000}); result.logout.push(r.status()); await r.dispose(); }
        catch { result.logout.push('unconfirmed'); }
      }
      await guest.context.close().catch(()=>{});
    }
    await browser?.close(); result.completedAt=new Date().toISOString();
    if(result.logout.some(s=>s!==200)) result.status='failed';
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify(result)); if(result.status!=='passed')process.exitCode=1;
  }
})().catch(()=>{ console.log('Check failed; private request details suppressed'); process.exitCode=1; });
