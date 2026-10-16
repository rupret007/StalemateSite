/**
 * Procedural SVG seat avatars for TurdSpades.
 */

const PALETTES = {
  you: { skin: '#c9e8b8', hat: '#9effc8', accent: '#ffd76a' },
  north: { skin: '#b8dcc9', hat: '#7ee8b0', accent: '#ffe08d' },
  west: { skin: '#e8c4b8', hat: '#ff9d74', accent: '#ffb8a0' },
  east: { skin: '#c4b8e8', hat: '#a8a0ff', accent: '#d4c8ff' }
};

export function avatarSvg(seatKey = 'you', mood = 'neutral') {
  const p = PALETTES[seatKey] || PALETTES.you;
  const eyeY = mood === 'happy' ? 38 : mood === 'sad' ? 40 : 39;
  const mouth =
    mood === 'happy'
      ? '<path d="M34 52 Q40 58 46 52" stroke="#1a3024" stroke-width="2" fill="none"/>'
      : mood === 'sad'
        ? '<path d="M34 56 Q40 50 46 56" stroke="#1a3024" stroke-width="2" fill="none"/>'
        : '<path d="M36 54 H44" stroke="#1a3024" stroke-width="2"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" role="img" aria-hidden="true">
    <defs><radialGradient id="g" cx="40%" cy="30%"><stop offset="0%" stop-color="${p.hat}"/><stop offset="100%" stop-color="#0f281c"/></radialGradient></defs>
    <circle cx="40" cy="44" r="28" fill="url(#g)" stroke="${p.accent}" stroke-width="2"/>
    <ellipse cx="40" cy="48" rx="18" ry="16" fill="${p.skin}"/>
    <circle cx="32" cy="${eyeY}" r="3" fill="#102016"/>
    <circle cx="48" cy="${eyeY}" r="3" fill="#102016"/>
    ${mouth}
    <text x="40" y="22" text-anchor="middle" font-size="14" fill="${p.accent}">\u2660</text>
  </svg>`;
}

export const SEAT_KEYS = ['you', 'west', 'north', 'east'];
