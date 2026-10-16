(() => {
  const c = document.getElementById('board'), x = c.getContext('2d');
  const W = c.width, H = c.height, $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WORD = ['STALE', 'MATE'];
  let bricks, ball, pad, score = 0, lives = 3, level = 1, state = 'ready', shareFile = null, raf;
  function build() {
    bricks = []; const cols = 8, bw = W / cols, bh = 22;
    for (let r = 0; r < 6; r++) for (let k = 0; k < cols; k++) {
      const label = r === 2 ? WORD[0][k - 1] : r === 3 ? WORD[1][k - 2] : '';
      bricks.push({ x: k * bw, y: 50 + r * bh, w: bw, h: bh, light: (r + k) % 2 === 0, label: label || '', hp: label ? 2 : 1 });
    }
  }
  function reset() { pad = { w: 70, x: W / 2 - 35, y: H - 28 }; const s = 4 + level * 0.6; ball = { x: W / 2, y: H - 40, vx: s * 0.6, vy: -s, r: 6, stuck: true }; }
  function hud() { $('score').textContent = score; $('lives').textContent = lives; $('level').textContent = level; }
  function draw() {
    x.fillStyle = '#0e0c0a'; x.fillRect(0, 0, W, H);
    for (const b of bricks) {
      x.fillStyle = b.label ? (b.hp > 1 ? '#ed2765' : '#20baff') : b.light ? '#f4f0e6' : '#3a312a';
      x.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      if (b.label) { x.fillStyle = '#f4f0e6'; x.font = '900 16px "Arial Narrow",Impact,sans-serif'; x.textAlign = 'center'; x.fillText(b.label, b.x + b.w / 2, b.y + 17); }
    }
    x.fillStyle = '#b5dc08'; x.fillRect(pad.x, pad.y, pad.w, 10);
    x.fillStyle = '#f4f0e6'; x.beginPath(); x.arc(ball.x, ball.y, ball.r, 0, 7); x.fill();
  }
  function step() {
    if (state !== 'play') return;
    if (ball.stuck) { ball.x = pad.x + pad.w / 2; ball.y = pad.y - ball.r - 1; }
    else {
      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.x < ball.r || ball.x > W - ball.r) ball.vx *= -1;
      if (ball.y < ball.r) ball.vy = Math.abs(ball.vy);
      if (ball.vy > 0 && ball.y + ball.r >= pad.y && ball.y < pad.y + 10 && ball.x > pad.x - 4 && ball.x < pad.x + pad.w + 4) {
        const hit = (ball.x - (pad.x + pad.w / 2)) / (pad.w / 2), sp = Math.hypot(ball.vx, ball.vy);
        ball.vx = sp * hit * 0.8; ball.vy = -Math.sqrt(sp * sp - ball.vx * ball.vx);
      }
      for (const b of bricks) if (b.hp > 0 && ball.x > b.x && ball.x < b.x + b.w && ball.y - ball.r < b.y + b.h && ball.y + ball.r > b.y) {
        b.hp--; ball.vy *= -1; score += b.label ? 50 : 10; if (!reduce && navigator.vibrate) navigator.vibrate(8); break;
      }
      bricks = bricks.filter(b => b.hp > 0);
      if (ball.y > H + 10) { lives--; if (lives <= 0) return end(false); reset(); }
      if (!bricks.length) return end(true);
    }
    hud(); draw(); raf = requestAnimationFrame(step);
  }
  function prepShare() {
    const s = document.createElement('canvas'); s.width = 1080; s.height = 1080; const g = s.getContext('2d');
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { g.fillStyle = (i + j) % 2 ? '#171410' : '#f4f0e6'; g.fillRect(i * 90, j * 90, 90, 90); }
    g.fillStyle = '#171410'; g.fillRect(90, 270, 900, 540); g.textAlign = 'center';
    g.fillStyle = '#ed2765'; g.font = '900 120px Impact,sans-serif'; g.fillText('STALEMATE', 540, 420);
    g.fillStyle = '#f4f0e6'; g.font = '900 90px Impact,sans-serif'; g.fillText(score + ' PTS', 540, 560);
    g.fillStyle = '#b5dc08'; g.font = '700 50px Impact,sans-serif'; g.fillText('stalemate.band', 540, 700);
    s.toBlob(b => { shareFile = b && new File([b], 'stalemate-score.png', { type: 'image/png' }); });
  }
  function end(won) {
    state = 'over'; cancelAnimationFrame(raf); hud(); draw(); prepShare();
    $('msg').textContent = won ? `Board cleared! ${score} points. Now go hear Manic.` : `Game over. ${score} points.`;
    $('start').textContent = won ? 'Next level' : 'Play again'; if (won) level++; else { level = 1; }
    $('share').hidden = false; $('listen').hidden = false; $('overlay').hidden = false;
    $('start').dataset.won = won ? '1' : '';
  }
  function start() {
    if (state === 'over' && !$('start').dataset.won) { score = 0; lives = 3; }
    if (state !== 'play') { if (state !== 'paused') { build(); reset(); } state = 'play'; $('overlay').hidden = true; raf = requestAnimationFrame(step); }
  }
  function launch() { if (state === 'play' && ball.stuck) ball.stuck = false; }
  $('start').onclick = start;
  $('share').onclick = () => {
    if (shareFile && navigator.canShare && navigator.canShare({ files: [shareFile] })) navigator.share({ files: [shareFile] }).catch(() => {});
    else if (navigator.share) navigator.share({ text: `I scored ${score} breaking the Stalemate checkerboard.` }).catch(() => {});
    else if (shareFile) { const a = document.createElement('a'); a.href = URL.createObjectURL(shareFile); a.download = shareFile.name; a.click(); }
  };
  const move = cx => { const r = c.getBoundingClientRect(); pad.x = Math.max(0, Math.min(W - pad.w, (cx - r.left) * W / r.width - pad.w / 2)); };
  c.addEventListener('pointerdown', e => { move(e.clientX); launch(); });
  c.addEventListener('pointermove', e => { if (state === 'play') move(e.clientX); });
  addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') pad.x = Math.max(0, pad.x - 24);
    else if (e.key === 'ArrowRight') pad.x = Math.min(W - pad.w, pad.x + 24);
    else if (e.key === ' ') { e.preventDefault(); if (state === 'play' && !ball.stuck) { state = 'paused'; $('msg').textContent = 'Paused'; $('overlay').hidden = false; } else if (state === 'play') launch(); else start(); }
    else return; if (state === 'play') draw();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') { state = 'paused'; $('msg').textContent = 'Paused'; $('overlay').hidden = false; } });
  build(); reset(); draw();
})();
