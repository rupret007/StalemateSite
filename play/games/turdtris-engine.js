/**
 * Turdtris Game Engine
 * Decoupled logic for Tetris Guideline-inspired gameplay.
 * Ported from turdtris.html to be unit-testable.
 */

export const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'Z', 'T'];

export const PIECE_SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
  O: [[1,1],[1,1]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  T: [[0,1,0],[1,1,1],[0,0,0]]
};

export class TurdtrisEngine {
  constructor(cols = 10, rows = 22) {
    this.cols = cols;
    this.rows = rows;
    this.grid = this.createGrid();
    this.bag = [];
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = 0;
    this.b2b = 0;
    this.gameOver = false;
  }

  createGrid() {
    const grid = [];
    for (let r = 0; r < this.rows; r++) {
      grid[r] = new Array(this.cols).fill(0);
    }
    return grid;
  }

  /**
   * 7-Bag Randomizer: Ensures all 7 pieces appear before any repeats.
   */
  getNextPieceType() {
    if (this.bag.length === 0) {
      this.bag = [...PIECE_TYPES];
      // Fisher-Yates shuffle
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  isValidMove(matrix, cellRow, cellCol) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c]) {
          const newRow = cellRow + r;
          const newCol = cellCol + c;
          if (
            newCol < 0 ||
            newCol >= this.cols ||
            newRow >= this.rows ||
            (newRow >= 0 && this.grid[newRow][newCol])
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }

  rotateMatrix(matrix) {
    const N = matrix.length;
    const result = matrix.map((row, i) =>
      row.map((val, j) => matrix[N - j - 1][i])
    );
    return result;
  }

  clearLines() {
    let linesFound = 0;
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.grid[r].every(cell => !!cell)) {
        this.grid.splice(r, 1);
        this.grid.unshift(new Array(this.cols).fill(0));
        linesFound++;
        r++; // Check same row index again as everything shifted down
      }
    }

    if (linesFound > 0) {
      this.lines += linesFound;
      this.updateScore(linesFound);
      this.combo++;
    } else {
      this.combo = 0;
    }

    return linesFound;
  }

  updateScore(lines) {
    const baseScores = [0, 100, 300, 500, 800];
    let award = baseScores[lines] * this.level;

    // Combo bonus
    if (this.combo > 0) {
      award += 50 * this.combo * this.level;
    }

    // Back-to-Back bonus (simplified)
    if (lines === 4) {
      if (this.lastWasDifficult) {
        award *= 1.5;
        this.b2b++;
      }
      this.lastWasDifficult = true;
    } else {
      this.lastWasDifficult = false;
      this.b2b = 0;
    }

    this.score += Math.floor(award);

    // Level up every 10 lines
    this.level = Math.floor(this.lines / 10) + 1;
  }
}
