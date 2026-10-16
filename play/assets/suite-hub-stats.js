/**
 * Read-only hub stat chips from existing localStorage keys (no new save formats).
 */

export const LIVE_HUB_PAGES = [
  'TurdAnoid.html',
  'turdtris.html',
  'turdjack.html',
  'crapeights.html',
  'turdrummy.html',
  'turdspades.html'
];

export function parseSafeInt(raw, fallback = 0) {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function readJsonObject(getItem, key) {
  try {
    const raw = getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {(key: string) => string | null} getItem
 * @param {string} href game card href
 * @returns {{ text: string, title?: string } | null}
 */
export function readHubStatBadge(getItem, href) {
  switch (href) {
    case 'TurdAnoid.html': {
      const best = parseSafeInt(getItem('turdanoid_v2_best'));
      const boss = parseSafeInt(getItem('turdanoid_boss_best_v1'));
      const parts = [];
      if (best > 0) parts.push(`Best ${best.toLocaleString('en-US')}`);
      if (boss > 0) parts.push(`Boss ${boss.toLocaleString('en-US')}`);
      return parts.length ? { text: parts.join(' · ') } : null;
    }
    case 'turdtris.html': {
      const best = parseSafeInt(getItem('turdtrisHighScore'));
      return best > 0 ? { text: `Best ${best.toLocaleString('en-US')}` } : null;
    }
    case 'turdjack.html': {
      const bankroll = parseSafeInt(getItem('turdjackBankroll'));
      const stats = readJsonObject(getItem, 'turdjackStats');
      const wins = stats && Number.isFinite(stats.wins) ? stats.wins : 0;
      if (bankroll > 0) {
        return { text: `$${bankroll.toLocaleString('en-US')}`, title: wins > 0 ? `${wins} wins` : undefined };
      }
      return wins > 0 ? { text: `${wins}W` } : null;
    }
    case 'crapeights.html': {
      const stats = readJsonObject(getItem, 'crapeightsStats');
      if (!stats) return null;
      const won = parseSafeInt(stats.matchesWon);
      const played = parseSafeInt(stats.matchesPlayed);
      if (played <= 0 && won <= 0) return null;
      return { text: won > 0 ? `${won} match wins` : `${played} played` };
    }
    case 'turdrummy.html': {
      const wrap = readJsonObject(getItem, 'turdrummy_stats_v1');
      const stats = wrap && wrap.stats && typeof wrap.stats === 'object' ? wrap.stats : null;
      if (!stats) return null;
      const gins = parseSafeInt(stats.playerGins);
      const rounds = parseSafeInt(stats.roundsPlayed);
      if (gins > 0) return { text: `${gins} gin${gins === 1 ? '' : 's'}` };
      return rounds > 0 ? { text: `${rounds} rounds` } : null;
    }
    case 'turdspades.html': {
      const stats = readJsonObject(getItem, 'turdspades_stats_v1');
      if (!stats) return null;
      const won = parseSafeInt(stats.matchesWon ?? stats.wins);
      const played = parseSafeInt(stats.matchesPlayed ?? stats.gamesPlayed);
      if (won > 0) return { text: `${won} match win${won === 1 ? '' : 's'}` };
      return played > 0 ? { text: `${played} played` } : null;
    }
    default:
      return null;
  }
}

/**
 * @param {Document} doc
 * @param {{ getItem: (key: string) => string | null }} storage
 */
export function decorateHubStatBadges(doc, storage) {
  const getItem = (key) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const cards = doc.querySelectorAll('.game-card');
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const href = card.getAttribute('href') || '';
    const existing = card.querySelector('.suite-hub-stat');
    if (existing) existing.remove();
    const badge = readHubStatBadge(getItem, href);
    if (!badge) continue;
    const el = doc.createElement('span');
    el.className = 'suite-hub-stat';
    el.textContent = badge.text;
    if (badge.title) el.setAttribute('title', badge.title);
    el.setAttribute('aria-hidden', 'true');
    const info = card.querySelector('.game-info');
    if (info) info.appendChild(el);
  }
}
