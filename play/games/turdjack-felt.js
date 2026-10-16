/** Procedural felt inlay SVG (data URL) for the Crapjack table. */

/**
 * @param {string} payoutLabel e.g. '3:2' or '6:5'
 * @param {boolean} dealerStands
 * @returns {string} CSS url("data:image/svg+xml,...") value
 */
export function buildFeltInlay(payoutLabel, dealerStands) {
  const line =
    '◆  CRAPJACK PAYS ' +
    payoutLabel +
    '  ◆  DEALER ' +
    (dealerStands ? 'STANDS ON 17' : 'HITS SOFT 17') +
    '  ◆';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 80">' +
    '<defs><path id="a" d="M 20 72 Q 500 4 980 72"/></defs>' +
    '<path d="M 20 44 Q 500 -24 980 44" fill="none" stroke="#ffd76a" stroke-opacity="0.24" stroke-width="1.4"/>' +
    '<path d="M 20 80 Q 500 12 980 80" fill="none" stroke="#ffd76a" stroke-opacity="0.24" stroke-width="1.4"/>' +
    '<text font-family="Trebuchet MS, Georgia, serif" font-size="25" font-weight="700" letter-spacing="4" fill="#ffd76a" fill-opacity="0.38">' +
    '<textPath href="#a" startOffset="50%" text-anchor="middle">' +
    line +
    '</textPath></text>' +
    '</svg>';
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}
