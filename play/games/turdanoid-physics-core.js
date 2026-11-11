/* Shared ball contact geometry for the campaign and Game Night. */
(function attachTurdanoidPhysics(root) {
  'use strict';

  function paddleVelocity(ball, paddle, english = 1.12) {
    const relative = (ball.x - paddle.x) / (paddle.w / 2);
    const angle = -Math.PI / 2 + Math.max(-1, Math.min(1, relative)) * english;
    const speed = Math.hypot(ball.vx, ball.vy);
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }

  function brickContact(ball, brick) {
    if (ball.x + ball.r <= brick.x || ball.x - ball.r >= brick.x + brick.w ||
        ball.y + ball.r <= brick.y || ball.y - ball.r >= brick.y + brick.h) { return null; }
    const dx = ball.x - (brick.x + brick.w / 2), dy = ball.y - (brick.y + brick.h / 2);
    return { dx, dy, px: brick.w / 2 + ball.r - Math.abs(dx), py: brick.h / 2 + ball.r - Math.abs(dy) };
  }

  root.TurdanoidPhysics = { paddleVelocity, brickContact };
})(typeof globalThis !== 'undefined' ? globalThis : this);
