// SPDX-License-Identifier: GPL-3.0-or-later
import { Chessground } from '../assets/chess/chessground.js';
export const MOVE_ANIMATION_MS = 160;

// Chessground owns pointer movement and animation. The existing square buttons
// remain the keyboard/assistive interface to the same authoritative game state.
export class ChessBoard {
  constructor(host, { select, move, cancel }) {
    this.host = host;
    this.serial = 0;
    this.gestureSerial = 0;
    this.key = '';
    this.grid = document.createElement('div');
    this.grid.className = 'board-input-grid';
    const attach = elements => {
      elements.board.append(this.grid);
      elements.board.setAttribute('role', 'presentation');
    };
    this.ground = Chessground(host, {
      coordinates: false,
      autoCastle: false,
      premovable: { enabled: false },
      predroppable: { enabled: false },
      draggable: { enabled: true, distance: 4, autoDistance: true, showGhost: true, deleteOnDropOff: false },
      drawable: { enabled: false, visible: false },
      events: { insert: attach }
    });
    host.dataset.renderer = 'chessground';
    this.actions = { select, move, cancel };
    this.motion = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', () => this.ground.set({ animation: { enabled: !this.motion.matches } }));
    host.addEventListener('mousedown', event => this.startGesture(event), true);
    host.addEventListener('touchstart', event => this.startGesture(event), { capture: true, passive: true });
    for (const name of ['mouseup', 'touchend']) {
      document.addEventListener(name, event => this.endGesture(event));
    }
    host.addEventListener('touchcancel', () => { this.cancel(); this.actions.cancel(); });
  }

  startGesture(event) {
    if (event.isTrusted && (event.button === undefined || event.button === 0)) {
      // Native dialog focus restoration and automatic scrolling can precede
      // the asynchronous scroll event. Hit-test the board at its actual position.
      this.ground.state.dom.bounds.clear();
      const point = event.touches?.[0] || event;
      this.gesture = { x: point.clientX, y: point.clientY, key: this.key, token: ++this.gestureSerial };
    }
  }

  endGesture(event) {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) { return; }
    const point = event.changedTouches?.[0] || event;
    if (Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) < 4) { return; }
    // A legal move callback runs first and changes the position key. An invalid
    // or outside drop must also reconcile the accessible selection with the art.
    setTimeout(() => {
      if (gesture.token === this.gestureSerial && gesture.key === this.key) { this.cancel(); this.actions.cancel(); }
    }, 5);
  }

  cancel() {
    this.serial++;
    this.gestureSerial++;
    this.key = '';
    this.selectionKey = '';
    this.allowed = false;
    this.gesture = null;
    this.ground.cancelMove();
  }

  update({ chess, id, view, flipped, selected, hint, last, allowed, local }) {
    const fen = chess.fen();
    const key = `${this.serial}:${id}:${fen}:${view}:${flipped}:${allowed}`;
    this.key = key;
    // Both people can click rapidly in local play. Keep their ordered selection
    // events across ordinary turns; explicit cancellation/orientation/view/game
    // changes still invalidate them. Drag commits remain tied to their exact FEN.
    const selectionKey = local ? `${this.serial}:${id}:${view}:${flipped}` : key;
    this.selectionKey = selectionKey;
    this.allowed = allowed;
    const valid = () => key === this.key && allowed && !document.hidden && !document.querySelector('dialog[open]');
    const validSelect = () => selectionKey === this.selectionKey && allowed && this.allowed && !document.hidden && !document.querySelector('dialog[open]');
    const dests = new Map();
    if (allowed) {
      for (const option of chess.moves({ verbose: true })) {
        if (!dests.has(option.from)) { dests.set(option.from, []); }
        if (!dests.get(option.from).includes(option.to)) { dests.get(option.from).push(option.to); }
      }
    }
    const custom = new Map();
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank++) {
        if ((file.charCodeAt(0) + rank) % 2 === 0) { custom.set(`${file}${rank}`, 'dark-square'); }
      }
    }
    if (hint) {
      for (const square of [hint.slice(0, 2), hint.slice(2, 4)]) { custom.set(square, `${custom.get(square) || ''} hinted`.trim()); }
    }
    const config = {
      orientation: flipped ? 'black' : 'white',
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.isCheck(),
      selected: selected || undefined,
      lastMove: last ? [last.from, last.to] : undefined,
      highlight: { lastMove: true, check: true, custom },
      movable: { free: false, color: allowed ? chess.turn() === 'w' ? 'white' : 'black' : undefined,
        dests, showDests: true, rookCastle: false,
        events: { after: (from, to) => { if (valid()) { this.actions.move(from, to); } } } },
      animation: { enabled: !this.motion.matches, duration: MOVE_ANIMATION_MS },
      events: { select: square => { if (validSelect()) { this.actions.select(square); } } }
    };
    // Always reconcile optimistic artwork against chess.js, including a pending
    // promotion. Selection-only updates preserve the native drag and animation.
    if (this.ground.getFen() !== fen.split(' ')[0]) {
      this.ground.cancelMove();
      config.fen = fen;
    }
    if (!allowed) { this.ground.cancelMove(); }
    this.ground.set(config);
  }
}
