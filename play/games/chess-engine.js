// SPDX-License-Identifier: GPL-3.0-or-later
import { LEVELS } from './chess-core.js';

// One active request owns the worker. A completed search leaves it warm for the
// next turn, avoiding repeated WASM downloads/compilation. Cancellation terminates
// both active and idle workers: no old search can cross that boundary.
export class ChessEngine {
  constructor({ workerFactory = url => new globalThis.Worker(url), timeout = 15000 } = {}) {
    this.workerFactory = workerFactory;
    this.timeout = timeout;
    this.active = null;
    this.idle = null;
  }

  cancel() {
    const job = this.active;
    this.active = null;
    this.idle?.terminate();
    this.idle = null;
    if (job) {
      clearTimeout(job.timer);
      job.worker?.terminate();
      job.resolve(null);
    }
  }

  search(moves, level = 'casual', { hint = false, start = null } = {}) {
    const warm = this.idle;
    this.idle = null;
    this.cancel();
    const tuning = LEVELS[hint ? 'sharp' : level];
    if (!tuning) { warm?.terminate(); return Promise.reject(new Error('Unknown difficulty')); }
    return new Promise((resolve, reject) => {
      const job = { resolve, worker: null, timer: null, stage: 'uci' };
      this.active = job;
      const finish = (value, error) => {
        if (this.active !== job) { return; }
        this.active = null;
        clearTimeout(job.timer);
        if (error) {
          job.worker?.terminate(); reject(error);
        } else {
          this.idle = job.worker;
          job.worker.onmessage = null;
          job.worker.onerror = event => {
            event.preventDefault?.();
            if (this.idle === job.worker) { this.idle = null; job.worker.terminate(); }
          };
          resolve(value);
        }
      };
      try {
        job.worker = warm || this.workerFactory(new globalThis.URL('../assets/chess/stockfish-loader.js#stockfish-19-lite-single.wasm', import.meta.url));
        job.timer = setTimeout(() => finish(null, new Error('The computer took too long to respond.')), this.timeout);
        job.worker.onerror = event => { event.preventDefault?.(); finish(null, new Error('The computer could not load.')); };
        job.worker.onmessage = event => {
          if (this.active !== job || typeof event.data !== 'string') { return; }
          for (const line of event.data.split('\n')) {
            if (line.trim() === 'uciok' && job.stage === 'uci') {
              job.stage = 'ready';
              job.worker.postMessage('setoption name Hash value 16');
              job.worker.postMessage('setoption name Clear Hash');
              job.worker.postMessage(`setoption name Skill Level value ${tuning.skill}`);
              job.worker.postMessage('isready');
            } else if (line.trim() === 'readyok' && job.stage === 'ready') {
              job.stage = 'search';
              job.worker.postMessage(`position ${start ? `fen ${start}` : 'startpos'}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
              job.worker.postMessage(`go depth ${tuning.depth} movetime ${tuning.ms}`);
            } else if (line.startsWith('bestmove ') && job.stage === 'search') {
              const move = line.split(/\s+/)[1];
              if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) { finish(move); }
              else { finish(null, new Error('The computer returned no playable move.')); }
            }
          }
        };
        job.worker.postMessage('uci');
      } catch { finish(null, new Error('This browser could not start the chess computer.')); }
    });
  }
}
