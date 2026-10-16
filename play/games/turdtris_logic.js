export const TETROMINOS = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
  O: [[1,1],[1,1]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  T: [[0,1,0],[1,1,1],[0,0,0]]
};

export const SRS_JLSTZ = {
  '0>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '1>0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '1>2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '2>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '2>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '3>2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '3>0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '0>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]]
};

export const SRS_I = {
  '0>1': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '1>0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '1>2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  '2>1': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '2>3': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '3>2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '3>0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '0>3': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
};

export function rotate(matrix, dir) {
  const N = matrix.length;
  const result = matrix.map((row, i) =>
    row.map((val, j) => (dir > 0 ? matrix[N - j - 1][i] : matrix[j][N - i - 1]))
  );
  return result;
}

export function isValidMove(matrix, cellRow, cellCol, playfield) {
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      if (matrix[row][col] && (
        cellCol + col < 0 ||
          cellCol + col >= playfield[0].length ||
          cellRow + row >= playfield.length ||
          playfield[cellRow + row][cellCol + col])
      ) {
        return false;
      }
    }
  }
  return true;
}

export function calculateScore(lines, level, isTspin = false, isB2B = false) {
  const lineScores = [0, 100, 300, 500, 800];
  const tspinScores = [0, 400, 800, 1200, 1600];

  let base = isTspin ? tspinScores[lines] : lineScores[lines];
  if (isB2B && lines > 0) {base *= 1.5;}
  return Math.floor(base * level);
}

export function getGravity(level) {
  // Classic Tetris gravity formula (G = frames/gridcell)
  // Higher level = lower number (faster)
  if (level < 1) {return 60;}
  if (level < 9) {return 60 - (level * 5);}
  if (level === 9) {return 6;}
  if (level >= 10 && level <= 12) {return 5;}
  if (level >= 13 && level <= 15) {return 4;}
  if (level >= 16 && level <= 18) {return 3;}
  if (level >= 19 && level <= 28) {return 2;}
  return 1; // Level 29+ is kill-screen speed
}

export function getLevelGoal(level) {
  if (level <= 5) {return 8;}
  if (level <= 15) {return 10;}
  if (level <= 30) {return 12;}
  if (level <= 45) {return 14;}
  if (level <= 60) {return 16;}
  if (level <= 80) {return 18;}
  return 20;
}
