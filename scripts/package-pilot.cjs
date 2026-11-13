'use strict';
// Build only the protected collaboration assets. The pilot Worker authenticates every asset request.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = process.argv[2] || 'pilot';
if (!['pilot', 'beta'].includes(target)) throw new Error('Choose pilot or beta assets.');
const out = path.join(root, `.${target}-assets`);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const dir of ['r', 'assets', ...(target === 'beta' ? ['join'] : [])]) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
if (target === 'beta') {
    const chessJoin = path.join(root, 'hangout-worker', 'web-join-chess');
    for (const file of ['index.html', 'session.js', 'game-offer.js']) {
        fs.copyFileSync(path.join(chessJoin, file), path.join(out, 'join', file));
    }
    const play = path.join(root, 'play');
    const matchReceipt = path.join(root, 'hangout-worker/arcade/VENDORED.txt');
    if (fs.existsSync(matchReceipt)) {
        const source = fs.readFileSync(matchReceipt, 'utf8').trim();
        if (!/^Turdanoid@[a-f0-9]{40}$/.test(source) || !fs.readFileSync(path.join(play, 'VENDORED.txt'), 'utf8').split('\n')[0].includes(source))
            throw Error('The protected match and arcade imports must use the same revision.');
        const files = [
            'games/chess-core.js', 'games/chess-board.js', 'assets/chess/chess.js',
            'games/turdrummy-rules.js',
            'games/turdtris-sprint.js', 'games/turdtris_logic.js', 'games/turdtris-presentation.js',
            'games/turdtris-modes.js', 'games/turdtris-art.js',
            'games/turdomania-core.js', 'assets/turdomania-tiles.svg',
            'games/turdrush-race.js', 'games/turdrush-core.js', 'games/turdrush-renderer.js',
            'games/arcade-action-clock.js', 'games/turdanoid-race.js', 'games/turdanoid-physics-core.js',
            'games/turdanoid-levels.js', 'games/turdanoid-levels-core.js', 'games/turdanoid-sprites-core.js',
            'assets/vendor/three/three.module.js', 'assets/vendor/three/three.core.js', 'assets/vendor/three/LICENSE',
            'assets/chess/chessground.js', 'assets/chess/chessground.base.css', 'assets/chess/chess-board.css',
            'assets/chess/chessground-10.5.0-source.tar.gz',
            'assets/chess/Chessground-LICENSE.txt', 'assets/chess/chessjs-LICENSE.txt',
            'assets/chess/Spatial-LICENSE.txt', 'assets/chess/GPL-3.0.txt'
        ];
        for (const color of ['w', 'b']) for (const piece of 'prnbqk') files.push(`assets/chess/pieces/spatial-${color}${piece}.svg`);
        for (const file of files) {
            const output = path.join(out, 'play', file);
            fs.mkdirSync(path.dirname(output), { recursive: true });
            fs.copyFileSync(path.join(play, file), output);
        }
    }
}
console.log(`Built private ${target} assets. Deploy with wrangler.${target}.toml only.`);
