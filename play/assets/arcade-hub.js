import { readDailyStatus } from '../games/turdomania-daily.js';

/** Extend the existing table Continue links and stat chips with the real daily record. */
export function bootDailyHub(doc, storage, now = () => Date.now()) {
  const action = doc.getElementById('daily-hub-play');
  const status = doc.getElementById('daily-hub-status');
  const next = doc.getElementById('daily-hub-next');
  if (!action || !status || !next) return;
  function update() {
    const daily = readDailyStatus(storage, now());
    const params = new URLSearchParams({ daily: daily.challenge.date, v: String(daily.challenge.rules) });
    action.href = `turdomania.html?${params}`;
    action.textContent = daily.result ? 'See result & replay ↗' : daily.status === 'continue' ? 'Continue today’s Dump ↗' : 'Play today’s Dump ↗';
    status.textContent = daily.result
      ? `${daily.challenge.date} · ${daily.result.score} points · ${daily.result.left} left · first result saved`
      : `${daily.challenge.date} · 8×10 · four kinds · no undo${daily.status === 'continue' ? ' · run saved' : ''}`;
    const reset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(daily.nextResetAt);
    next.textContent = `Next puzzle at ${reset} · America/Chicago. Records stay on this device.`;
    if (daily.storageStatus === 'unavailable') next.textContent += ' Storage is unavailable here.';
    let previous = doc.getElementById('daily-hub-previous');
    const pending = daily.previous || (daily.resume && daily.resume.challenge.id !== daily.challenge.id ? daily.resume : null);
    if (pending) {
      if (!previous) {
        previous = doc.createElement('a');
        previous.id = 'daily-hub-previous';
        previous.className = 'daily-previous';
        next.after(previous);
      }
      previous.href = `turdomania.html?daily=${pending.challenge.date}&v=${pending.challenge.rules}`;
      previous.textContent = `Finish your ${pending.challenge.date} Dump →`;
    } else if (previous) previous.remove();
  }
  update();
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) update(); });
  doc.defaultView?.addEventListener('storage', update);
  // Refresh the hub at date rollover without changing an active game's identity.
  const timer = doc.defaultView?.setInterval(update, 60000);
  doc.defaultView?.addEventListener('pagehide', () => doc.defaultView.clearInterval(timer), { once: true });
}
