const NEON_BALANCE = {
    launch: {
        baseBallSpeed: 4.95,
        speedPerLevel: 0.36,
        earlyFloorLevel: 5,
        earlyFloorSpeed: 6.05,
        maxBallSpeed: 13.6
    },
    drops: {
        baseDropChance: 0.34,
        perLevel: 0.0026,
        droughtPerBlock: 0.012,
        droughtCap: 0.2,
        maxDropChance: 0.37
    },
    power: {
        defaultDuration: 620,
        extraLifeCooldown: 2400
    },
    progression: {
        patternCount: 17,
        maxRemixes: 16
    }
};
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        if (!this.canvas) throw new Error('Canvas element not found');

        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) throw new Error('Could not get 2D context');

        this.config = {
            baseBallSpeed: NEON_BALANCE.launch.baseBallSpeed,
            speedPerLevel: NEON_BALANCE.launch.speedPerLevel,
            earlyFloorLevel: NEON_BALANCE.launch.earlyFloorLevel,
            earlyFloorSpeed: NEON_BALANCE.launch.earlyFloorSpeed,
            maxBallSpeed: NEON_BALANCE.launch.maxBallSpeed,
            paddleSpeed: 10,
            maxParticles: 340,
            comboTimeoutFrames: 210,
            defaultPowerDuration: NEON_BALANCE.power.defaultDuration,
            blockDropChance: NEON_BALANCE.drops.baseDropChance,
            dropChancePerLevel: NEON_BALANCE.drops.perLevel,
            droughtPerBlock: NEON_BALANCE.drops.droughtPerBlock,
            droughtCap: NEON_BALANCE.drops.droughtCap,
            maxDropChance: NEON_BALANCE.drops.maxDropChance,
            maxRemixes: NEON_BALANCE.progression.maxRemixes,
            shieldYInset: 14,
            maxLevel: 69
        };

        this.frame = 0;
        this.animationFrameId = null;
        this.gameRunning = true;
        this.gameWon = false;
        this.paused = false;
        this.awaitingLaunch = true;

        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.combo = 0;
        this.comboTimer = 0;
        this.runBestCombo = 0;
        this.levelMistakes = 0;
        this.levelPatternName = 'Classic Grid';
        this.levelProfile = null;
        this.levelMutatorText = '';
        this.runSeed = this.createRunSeed();
        this.levelLayoutSignatures = new Set();
        this.levelLayoutSignature = '';

        this.highScore = this.readNumber('neonArkanoidHighScore', 0);
        this.bestCombo = this.readNumber('neonArkanoidBestCombo', 0);
        this.totalBlocksBroken = this.readNumber('neonArkanoidBlocksBroken', 0);
        this.powerUpsCollected = this.readNumber('neonArkanoidPowerUpsCollected', 0);
        this.perfectLevels = this.readNumber('neonArkanoidPerfectLevels', 0);
        this.achievements = this.readObject('neonArkanoidAchievements', {});

        this.audioCtx = null;
        this.toastTimeoutId = null;
        this.muted = localStorage.getItem('neonArkanoidMuted') === '1';

        this.controls = {
            left: false,
            right: false,
            pointerX: this.canvas.width / 2,
            pointerActive: false
        };

        this.paddleBaseWidth = 120;
        this.paddle = {
            x: this.canvas.width / 2 - this.paddleBaseWidth / 2,
            y: this.canvas.height - 34,
            width: this.paddleBaseWidth,
            height: 15,
            speed: this.config.paddleSpeed,
            velocityX: 0,
            color: '#6ef7d5'
        };

        this.mainBall = this.createBall(this.canvas.width / 2, this.canvas.height - 52, 0, 0, true);
        this.balls = [this.mainBall];
        this.blocks = [];
        this.powerUpDrops = [];
        this.projectiles = [];
        this.particles = [];
        this.ambientParticles = [];
        this.floatTexts = [];
        this.activePowerUps = {};

        this.screenShake = 0;
        this.ghostCharges = 0;
        this.shieldHits = 0;
        this.levelBlocksTotal = 0;
        this.extraLifeCooldown = 0;
        this.blocksSinceDrop = 0;
        this.waldo = null;

        this.ui = {
            score: document.getElementById('score'),
            highScore: document.getElementById('highScore'),
            lives: document.getElementById('lives'),
            level: document.getElementById('level'),
            combo: document.getElementById('combo'),
            comboDisplay: document.getElementById('comboDisplay'),
            bestCombo: document.getElementById('bestCombo'),
            objective: document.getElementById('objectiveText'),
            status: document.getElementById('statusLine'),
            pattern: document.getElementById('modeText'),
            activePowerList: document.getElementById('activePowerList'),
            finalScore: document.getElementById('finalScore'),
            gameOver: document.getElementById('gameOver'),
            endTitle: document.getElementById('endTitle'),
            endSubtitle: document.getElementById('endSubtitle'),
            pauseOverlay: document.getElementById('pauseOverlay'),
            achievementsList: document.getElementById('achievementsList'),
            achievementToast: document.getElementById('achievementToast'),
            muteBtn: document.getElementById('muteBtn')
        };

        this.boundHandlers = {
            mouseMove: (event) => this.handlePointerMove(event),
            touchMove: (event) => this.handleTouchMove(event),
            touchStart: (event) => this.handleTouchStart(event),
            keyDown: (event) => this.handleKeyDown(event),
            keyUp: (event) => this.handleKeyUp(event),
            canvasDown: () => this.handleCanvasInteraction(),
            windowBlur: () => this.handleWindowBlur(),
            visibilityChange: () => this.handleVisibilityChange(),
            virtualDown: (event) => this.handleVirtualControl(event, true),
            virtualUp: (event) => this.handleVirtualControl(event, false)
        };

        this.init();
    }

    init() {
        this.createAmbientParticles();
        this.setupLevel();
        this.bindEvents();
        this.updateMuteButton();
        this.updateUI();
        this.setStatus(`Launch the ball and survive the chaos climb to level ${this.config.maxLevel}.`);
        this.ensureGameLoopRunning();
    }

    bindEvents() {
        document.addEventListener('mousemove', this.boundHandlers.mouseMove);
        document.addEventListener('keydown', this.boundHandlers.keyDown);
        document.addEventListener('keyup', this.boundHandlers.keyUp);
        this.canvas.addEventListener('mousedown', this.boundHandlers.canvasDown);

        const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (touchCapable) {
            this.canvas.addEventListener('touchstart', this.boundHandlers.touchStart, { passive: false });
            this.canvas.addEventListener('touchmove', this.boundHandlers.touchMove, { passive: false });
            const mobileControls = document.getElementById('mobileControls');
            if (mobileControls) {
                mobileControls.style.display = 'flex';
                mobileControls.addEventListener('pointerdown', this.boundHandlers.virtualDown);
                mobileControls.addEventListener('pointerup', this.boundHandlers.virtualUp);
                mobileControls.addEventListener('pointercancel', this.boundHandlers.virtualUp);
                mobileControls.addEventListener('pointerleave', this.boundHandlers.virtualUp);
            }
        }

        window.addEventListener('blur', this.boundHandlers.windowBlur);
        document.addEventListener('visibilitychange', this.boundHandlers.visibilityChange);
    }

    destroy() {
        document.removeEventListener('mousemove', this.boundHandlers.mouseMove);
        document.removeEventListener('keydown', this.boundHandlers.keyDown);
        document.removeEventListener('keyup', this.boundHandlers.keyUp);
        this.canvas.removeEventListener('mousedown', this.boundHandlers.canvasDown);
        this.canvas.removeEventListener('touchstart', this.boundHandlers.touchStart);
        this.canvas.removeEventListener('touchmove', this.boundHandlers.touchMove);
        window.removeEventListener('blur', this.boundHandlers.windowBlur);
        document.removeEventListener('visibilitychange', this.boundHandlers.visibilityChange);

        const mobileControls = document.getElementById('mobileControls');
        if (mobileControls) {
            mobileControls.removeEventListener('pointerdown', this.boundHandlers.virtualDown);
            mobileControls.removeEventListener('pointerup', this.boundHandlers.virtualUp);
            mobileControls.removeEventListener('pointercancel', this.boundHandlers.virtualUp);
            mobileControls.removeEventListener('pointerleave', this.boundHandlers.virtualUp);
        }

        this.stopGameLoop();
    }

    createBall(x, y, dx, dy, isMain) {
        return {
            x,
            y,
            radius: 8,
            dx,
            dy,
            speed: this.getBaseBallSpeed(),
            isMain,
            trail: [],
            color: isMain ? '#ff8f70' : '#ffe08a'
        };
    }

    setupLevel() {
        this.clearCombatState();
        this.awaitingLaunch = true;
        this.levelMistakes = 0;
        this.combo = 0;
        this.comboTimer = 0;
        this.blocksSinceDrop = 0;
        this.levelProfile = null;
        this.levelMutatorText = '';

        let variation = 0;
        while (variation < this.config.maxRemixes) {
            this.levelProfile = this.buildLevelProfile(this.level, variation);
            this.generateBlocks();
            if (!this.levelLayoutSignatures.has(this.levelLayoutSignature) || variation === this.config.maxRemixes - 1) break;
            variation++;
        }
        this.levelLayoutSignatures.add(this.levelLayoutSignature);
        this.applyLevelMutators(this.levelProfile);

        this.resetPaddleSize();
        this.spawnMainBall();

        this.activePowerUps = {};
        this.ghostCharges = 0;
        this.shieldHits = 0;
        this.setupWaldo();

        this.levelPatternName = this.getPatternName(this.levelProfile);
        this.setObjective(`Break ${this.levelBlocksTotal} blocks this wave. Reach level ${this.config.maxLevel}.`);
        this.updateModeSummary();
    }

    clearCombatState() {
        this.blocks = [];
        this.powerUpDrops = [];
        this.projectiles = [];
        this.floatTexts = [];
        this.particles = this.particles.filter((particle) => particle.ambient);
    }

    resetPaddleSize() {
        this.paddle.width = this.paddleBaseWidth;
        this.paddle.x = this.clamp(this.paddle.x, 0, this.canvas.width - this.paddle.width);
    }

    spawnMainBall() {
        this.mainBall = this.createBall(
            this.paddle.x + this.paddle.width / 2,
            this.paddle.y - 12,
            0,
            0,
            true
        );
        this.balls = [this.mainBall];
    }

    createRunSeed() {
        return Math.floor(Math.random() * 1000000000);
    }

    levelRandom(level, salt, variation) {
        const remix = (variation || 0) * 173.317;
        const x = Math.sin((level * 9283.771) + (salt * 631.97) + this.runSeed * 0.000001 + remix) * 43758.5453123;
        return x - Math.floor(x);
    }

    buildLevelProfile(level, variation) {
        const remix = variation || 0;
        const tier = Math.min(5, Math.floor((level - 1) / 12));
        const bossLevel = (level % 10 === 0) || level === this.config.maxLevel;
        const lateRamp = level >= 56 ? 0.06 : 0;
        const chaos = this.clamp(0.1 + (level - 1) * 0.014 + tier * 0.018 + lateRamp, 0.1, 0.995);
        const pattern = Math.floor(this.levelRandom(level, 7, remix) * NEON_BALANCE.progression.patternCount);
        const variant = Math.floor(this.levelRandom(level, 11, remix) * 5);
        const rows = Math.min(13, 5 + Math.floor((level - 1) / 2.6));
        const cols = Math.min(17, 12 + Math.floor((level - 1) / 9));
        const carveChance = this.clamp((this.levelRandom(level, 13, remix) - 0.5) * 0.22 + chaos * 0.1, 0, 0.26);
        const fillChance = this.clamp((this.levelRandom(level, 17, remix) - 0.5) * 0.12 + chaos * 0.05 + (bossLevel ? 0.02 : 0), 0, 0.16);
        const hazardBoost = chaos * 0.27 + Math.floor((level - 1) / 10) * 0.02 + tier * 0.014 + (bossLevel ? 0.06 : 0);
        const driftBoost = 0.012 + chaos * 0.035 + (bossLevel ? 0.01 : 0);
        const density = this.clamp(0.82 - chaos * 0.22 + (this.levelRandom(level, 19, remix) - 0.5) * 0.14 + (bossLevel ? 0.03 : 0), 0.56, 0.95);
        const names = [
            'Classic Grid',
            'Checker Run',
            'Tunnel Strike',
            'Wave Grid',
            'Fortress Lines',
            'Spike Field',
            'Doom Ring',
            'Hourglass Trap',
            'Crossfire',
            'Zigzag Storm',
            'Spiral Maze',
            'Chaos Bloom',
            'Razor Channel',
            'Twin Rift',
            'Vortex Cage',
            'Pinball Lattice',
            'Waldo Mirage'
        ];
        const mods = ['Prime', 'Warp', 'Overdrive', 'Mutant', 'Apocalypse'];

        return {
            level,
            chaos,
            chaosPercent: Math.round(chaos * 100),
            pattern,
            variant,
            tier,
            bossLevel,
            variation: remix,
            rows,
            cols,
            carveChance,
            fillChance,
            hazardBoost,
            driftBoost,
            density,
            name: `${names[pattern]} ${mods[variant]}`
        };
    }

    getPatternName(profile) {
        if (!profile || typeof profile !== 'object') return 'Classic Grid';
        return profile.name || 'Classic Grid';
    }

    shouldSpawnBlock(profile, row, col, rows, cols) {
        const centerCol = (cols - 1) / 2;
        const centerRow = (rows - 1) / 2;
        const nx = (col + 0.5) / cols;
        const ny = (row + 0.5) / rows;
        const cx = nx - 0.5;
        const cy = ny - 0.5;
        const dist = Math.hypot(cx, cy);
        const angle = Math.atan2(cy, cx);
        const wave = Math.sin((nx * Math.PI * (2 + profile.variant)) + profile.level * 0.21);
        const ridge = Math.cos((ny * Math.PI * (3 + (profile.variant % 3))) - profile.level * 0.17);
        const remix = profile.variation || 0;

        let base = true;
        switch (profile.pattern % NEON_BALANCE.progression.patternCount) {
            case 0:
                base = true;
                break;
            case 1:
                base = ((row + col + profile.variant) % 2 === 0) || row < 2;
                break;
            case 2: {
                const tunnel = Math.max(1, Math.floor((rows - row) / 4) + (profile.variant % 2));
                base = Math.abs(col - centerCol) > tunnel;
                break;
            }
            case 3: {
                const expected = Math.floor((wave + 1) * (rows - 1) * 0.5);
                base = Math.abs(row - expected) <= (profile.variant === 2 ? 2 : 1) || row < 2;
                break;
            }
            case 4:
                base = row === 0 || row === rows - 1 || col === 0 || col === cols - 1 || (col + row) % 3 !== 1;
                break;
            case 5:
                base = col >= Math.floor(row / 2) - profile.variant && col <= cols - 1 - Math.floor(row / 2) + profile.variant;
                break;
            case 6: {
                const inner = 0.18 + profile.variant * 0.03;
                const outer = 0.44 + profile.variant * 0.02;
                base = dist >= inner && dist <= outer;
                break;
            }
            case 7: {
                const width = Math.max(1, Math.floor((rows / 2 - Math.abs(row - centerRow)) / 1.25) + (profile.variant % 2));
                base = Math.abs(col - centerCol) <= width;
                break;
            }
            case 8:
                base = row === Math.floor(centerRow) || col === Math.floor(centerCol) || Math.abs(row - centerRow) === Math.abs(col - centerCol);
                break;
            case 9: {
                const expected = (row * 2 + profile.variant) % cols;
                base = Math.abs(col - expected) <= 1 || Math.abs(col - ((cols - 1) - expected)) <= 1;
                break;
            }
            case 10: {
                const spiral = (Math.sin(angle * 3 + dist * 18 + profile.level * 0.35) + 1) * 0.5;
                base = spiral > (0.45 - profile.chaos * 0.1);
                break;
            }
            case 12:
                base = ((row * 2 + col + profile.variant) % 3 !== 1) || Math.abs(col - centerCol) <= 1 + (profile.variant % 2);
                break;
            case 13:
                base = Math.abs(col - centerCol) >= 2 + (profile.variant % 3);
                if (row === rows - 1 && col % 2 === 1) base = false;
                break;
            case 14: {
                const laneArc = Math.abs(dist - (0.22 + 0.12 * Math.sin(angle * (3 + (profile.variant % 2)) + profile.level * 0.18)));
                const cross = Math.abs(Math.sin(angle * 6 + profile.variant)) > 0.54;
                base = laneArc < 0.09 || cross || row < 2;
                break;
            }
            case 15: {
                const laneA = ((row + profile.variant) % 4 === 0);
                const laneB = ((col * 2 + row + profile.variant) % 5 === 0);
                const pockets = Math.abs(col - centerCol) <= 1 && row % 2 === 0;
                base = laneA || laneB || pockets || row < 2;
                break;
            }
            case 16: {
                const mirage = Math.sin((nx + ny) * Math.PI * (3 + profile.variant * 0.45) + profile.level * 0.31);
                const cross = Math.abs(col - centerCol) <= 1 || Math.abs(row - centerRow) <= 1;
                base = mirage > -0.08 || cross;
                if ((row + col + profile.variant) % 5 === 0) base = !base;
                break;
            }
            default: {
                const noise = this.levelRandom(profile.level, 5000 + row * 97 + col * 57, remix);
                base = noise < profile.density + 0.06;
                break;
            }
        }

        if (row < 2 && this.levelRandom(profile.level, 9000 + row * 37 + col * 17, remix) < 0.88) {
            base = true;
        }

        const noise = this.levelRandom(profile.level, 10000 + row * 131 + col * 71, remix);
        if (base && noise < profile.carveChance) base = false;
        else if (!base && noise < profile.fillChance) base = true;

        if (!base && ridge > 0.86 && this.levelRandom(profile.level, 12000 + row * 41 + col * 29, remix) < 0.22) {
            base = true;
        }

        if (profile.level >= 45 && row % 3 === 0 && this.levelRandom(profile.level, 12500 + row * 11 + col * 19, remix) < profile.chaos * 0.22) {
            base = !base;
        }

        if (profile.bossLevel) {
            const moatWidth = 1 + (profile.variant % 2);
            const inCore = Math.abs(col - centerCol) <= moatWidth && row > 1 && row < rows - 1;
            if (inCore && this.levelRandom(profile.level, 13100 + row * 13 + col * 17, remix) < 0.72) base = false;
            if (!base && row === rows - 1 && this.levelRandom(profile.level, 13300 + col * 7, remix) < 0.55) base = true;
        }

        return base;
    }

    pickBlockType(row, profile) {
        const roll = Math.random();
        const bossPush = profile.bossLevel ? 0.08 : 0;
        const eliteChance = this.clamp(0.015 + profile.hazardBoost * 0.25 + (this.level >= 42 ? 0.05 : 0) + bossPush + (this.level >= 60 ? 0.05 : 0), 0.02, 0.4);
        const movingChance = this.clamp(0.05 + profile.hazardBoost * 0.3 + (row % 3 === 0 ? 0.02 : 0) + bossPush * 0.8, 0.06, 0.46);
        const explosiveChance = this.clamp(0.08 + profile.hazardBoost * 0.24 + bossPush * 0.6, 0.08, 0.4);
        const armoredChance = this.clamp(0.22 + profile.hazardBoost * 0.22 + row * 0.015 + bossPush, 0.22, 0.76);

        let threshold = eliteChance;
        if (this.level >= 8 && roll < threshold) return 'elite';
        threshold += movingChance;
        if (this.level >= 5 && roll < threshold) return 'moving';
        threshold += explosiveChance;
        if (this.level >= 3 && roll < threshold) return 'explosive';
        threshold += armoredChance;
        if (roll < threshold || (row < 2 && Math.random() < 0.52)) return 'armored';
        return 'normal';
    }

    getBlockColor(row, type) {
        const baseColors = ['#ff7285', '#ff9863', '#ffd369', '#5df2c0', '#6ec8ff', '#b58dff', '#ff82d9', '#72f1ff'];
        const base = baseColors[row % baseColors.length];
        const overlays = {
            normal: base,
            armored: '#8ec5ff',
            explosive: '#ff6f61',
            moving: '#76ffd7',
            elite: '#ffe38b'
        };
        return overlays[type] || base;
    }

    generateBlocks() {
        const profile = this.levelProfile || this.buildLevelProfile(this.level);
        const rows = profile.rows;
        const cols = profile.cols;
        const gap = Math.max(3, 6 - Math.floor(this.level / 18));
        const marginX = 32;
        const startY = 64;
        const blockWidth = Math.floor((this.canvas.width - marginX * 2 - gap * (cols - 1)) / cols);
        const blockHeight = Math.max(16, Math.floor(24 - this.level / 20));

        this.blocks = [];
        let occupancyPattern = '';
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const spawnBlock = this.shouldSpawnBlock(profile, row, col, rows, cols);
                occupancyPattern += spawnBlock ? '1' : '0';
                if (!spawnBlock) continue;

                const x = marginX + col * (blockWidth + gap);
                const y = startY + row * (blockHeight + gap);
                const type = this.pickBlockType(row, profile);

                const armoredHealth = 2 + Math.floor((this.level - 1) / 8) + (profile.bossLevel ? 1 : 0);
                const healthByType = {
                    normal: 1,
                    armored: armoredHealth,
                    explosive: 1,
                    moving: 1 + Math.floor(this.level / 5),
                    elite: 3 + Math.floor(this.level / 3)
                };
                const valuesByType = {
                    normal: 12 + Math.floor(this.level / 3),
                    armored: 20 + Math.floor(this.level / 2),
                    explosive: 18 + Math.floor(this.level / 2),
                    moving: 22 + Math.floor(this.level / 2),
                    elite: 35 + Math.floor(this.level * 0.8)
                };

                const health = healthByType[type] || 1;
                this.blocks.push({
                    x,
                    y,
                    width: blockWidth,
                    height: blockHeight,
                    type,
                    health,
                    maxHealth: health,
                    value: valuesByType[type] || 10,
                    color: this.getBlockColor(row, type),
                    baseX: x,
                    driftPhase: Math.random() * Math.PI * 2,
                    driftSpeed: profile.driftBoost + Math.random() * (0.01 + profile.chaos * 0.015),
                    driftAmount: 8 + Math.random() * (10 + profile.chaos * 9)
                });
            }
            occupancyPattern += '|';
        }

        if (this.blocks.length === 0) {
            this.blocks.push({
                x: this.canvas.width / 2 - 60,
                y: 100,
                width: 120,
                height: 24,
                type: 'elite',
                health: 3,
                maxHealth: 3,
                value: 45,
                color: '#ffcf6a',
                baseX: this.canvas.width / 2 - 60,
                driftPhase: 0,
                driftSpeed: 0,
                driftAmount: 0
            });
        }

        this.levelLayoutSignature = `${rows}x${cols}:${occupancyPattern}`;
        this.levelBlocksTotal = this.blocks.length;
    }

    applyLevelMutators(profile) {
        if (!profile || !this.blocks || this.blocks.length === 0) {
            this.levelMutatorText = '';
            return;
        }

        const notes = [];

        if (this.level >= 36) {
            let feral = 0;
            for (let i = 0; i < this.blocks.length; i++) {
                const block = this.blocks[i];
                if (block.type !== 'normal') continue;
                if (Math.random() < 0.08 + profile.chaos * 0.12) {
                    block.type = Math.random() < 0.58 ? 'explosive' : 'moving';
                    block.health = block.type === 'moving' ? 2 + Math.floor(this.level / 6) : 1;
                    block.maxHealth = block.health;
                    block.color = block.type === 'moving' ? '#76ffd7' : '#ff6f61';
                    feral++;
                }
            }
            if (feral > 0) notes.push(`${feral} feral blocks`);
        }

        if (this.level >= 52 && this.level % 4 === 0) {
            let reinforced = 0;
            for (let i = 0; i < this.blocks.length; i++) {
                const block = this.blocks[i];
                if (block.type === 'elite' || Math.random() < 0.16) {
                    block.health += 1;
                    block.maxHealth += 1;
                    reinforced++;
                }
            }
            if (reinforced > 0) notes.push(`${reinforced} reinforced cores`);
        }

        if (this.level >= 60) {
            let drifted = 0;
            for (let i = 0; i < this.blocks.length; i++) {
                const block = this.blocks[i];
                if (block.type !== 'moving') continue;
                block.driftAmount += 6 + Math.random() * 10;
                block.driftSpeed += 0.006 + Math.random() * 0.012;
                drifted++;
            }
            if (drifted > 0) notes.push(`${drifted} overdrive drifters`);
        }

        this.levelMutatorText = notes.length ? `Mutator: ${notes.join(', ')}.` : '';
    }

    setupWaldo() {
        const chance = this.clamp(0.14 + this.level * 0.004, 0.14, 0.48);
        if (Math.random() > chance) {
            this.waldo = null;
            return;
        }

        const size = 18 + Math.min(12, Math.floor(this.level / 5));
        const minY = 56;
        const maxY = Math.min(this.canvas.height * 0.42, 210 + this.level * 1.3);
        const speed = 0.45 + Math.random() * 0.7 + this.level * 0.01;

        this.waldo = {
            active: true,
            found: false,
            x: size + Math.random() * Math.max(1, this.canvas.width - size * 2),
            y: minY + Math.random() * Math.max(1, maxY - minY),
            size,
            vx: Math.random() > 0.5 ? speed : -speed,
            life: 620 + this.level * 12,
            blink: Math.random() * Math.PI * 2
        };
    }

    updateWaldo() {
        if (!this.waldo || !this.waldo.active) return;

        const waldo = this.waldo;
        waldo.blink += 0.13;
        waldo.life--;
        waldo.x += waldo.vx;

        const half = waldo.size * 0.5;
        if (waldo.x <= half || waldo.x >= this.canvas.width - half) {
            waldo.vx *= -1;
            waldo.x = this.clamp(waldo.x, half, this.canvas.width - half);
        }

        if (waldo.life <= 0) {
            waldo.active = false;
            this.updateModeSummary();
            return;
        }

        const hitW = waldo.size * 0.52;
        const hitH = waldo.size * 0.78;
        for (let i = 0; i < this.balls.length; i++) {
            const ball = this.balls[i];
            if (
                ball.x + ball.radius >= waldo.x - hitW &&
                ball.x - ball.radius <= waldo.x + hitW &&
                ball.y + ball.radius >= waldo.y - hitH &&
                ball.y - ball.radius <= waldo.y + hitH
            ) {
                waldo.active = false;
                waldo.found = true;
                const bonus = 169 + this.level * 9;
                this.score += bonus;
                this.spawnFloatText(`WALDO +${bonus}`, waldo.x, waldo.y - 12, '#ffed8a');
                this.setStatus(`You found Waldo. +${bonus} bonus chaos points.`);
                this.screenShake = Math.max(this.screenShake, 8);
                this.updateModeSummary();
                break;
            }
        }
    }

    getBaseBallSpeed() {
        const levelSpeed = this.config.baseBallSpeed + (this.level - 1) * this.config.speedPerLevel;
        const floorSpeed = this.level <= this.config.earlyFloorLevel ? this.config.earlyFloorSpeed : this.config.baseBallSpeed;
        const overdriveActive = this.activePowerUps && this.activePowerUps.overdrive > 0;
        const overdriveBoost = overdriveActive ? 1.1 : 0;
        return Math.min(this.config.maxBallSpeed, Math.max(floorSpeed, levelSpeed + overdriveBoost));
    }

    setObjective(text) {
        if (this.ui.objective) this.ui.objective.textContent = text;
    }

    setStatus(text) {
        if (this.ui.status) this.ui.status.textContent = text;
    }

    setMode(text) {
        if (this.ui.pattern) this.ui.pattern.textContent = text;
    }

    updateModeSummary() {
        if (!this.levelProfile) return;
        const bossTag = this.levelProfile.bossLevel ? ' | Boss Wave' : '';
        const remixTag = this.levelProfile.variation > 0 ? ` | Remix ${this.levelProfile.variation + 1}` : '';
        const waldoTag = this.waldo && this.waldo.active ? ' | Waldo?' : '';
        const mutatorTag = this.levelMutatorText ? ` | ${this.levelMutatorText}` : '';
        this.setMode(`Pattern: ${this.levelPatternName} | Chaos ${this.levelProfile.chaosPercent}%${bossTag}${remixTag}${waldoTag}${mutatorTag}`);
    }

    updateMuteButton() {
        const label = this.muted ? 'Unmute' : 'Mute';
        if (this.ui.muteBtn) this.ui.muteBtn.textContent = label;
        document.querySelectorAll('[data-mute-btn]').forEach((btn) => {
            btn.textContent = label;
        });
    }

    toggleMute() {
        this.muted = !this.muted;
        localStorage.setItem('neonArkanoidMuted', this.muted ? '1' : '0');
        this.updateMuteButton();
    }

    unlockAudio() {
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
            return;
        }
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            this.audioCtx = null;
        }
    }

    playSound(type) {
        if (this.muted || !this.audioCtx) return;

        const profiles = {
            block: { frequency: 480, duration: 0.06, wave: 'square', volume: 0.08 },
            paddle: { frequency: 250, duration: 0.05, wave: 'triangle', volume: 0.08 },
            wall: { frequency: 180, duration: 0.03, wave: 'sine', volume: 0.04 },
            armor: { frequency: 130, duration: 0.05, wave: 'sawtooth', volume: 0.06 },
            powerUp: { frequency: 840, duration: 0.1, wave: 'triangle', volume: 0.08 },
            shield: { frequency: 620, duration: 0.05, wave: 'sine', volume: 0.07 },
            loseLife: { frequency: 120, duration: 0.2, wave: 'sawtooth', volume: 0.08 },
            level: { frequency: 720, duration: 0.16, wave: 'triangle', volume: 0.08 },
            gameOver: { frequency: 90, duration: 0.25, wave: 'sawtooth', volume: 0.08 },
            victory: { frequency: 980, duration: 0.22, wave: 'triangle', volume: 0.1 },
            launch: { frequency: 560, duration: 0.08, wave: 'triangle', volume: 0.08 },
            achievement: { frequency: 980, duration: 0.13, wave: 'triangle', volume: 0.1 }
        };

        const profile = profiles[type] || profiles.block;
        try {
            const now = this.audioCtx.currentTime;
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = profile.wave;
            osc.frequency.setValueAtTime(profile.frequency, now);
            gain.gain.setValueAtTime(profile.volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + profile.duration);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start(now);
            osc.stop(now + profile.duration);
        } catch (error) {}
    }
    handleWindowBlur() {
        this.controls.left = false;
        this.controls.right = false;
        this.controls.pointerActive = false;
        if (this.gameRunning) this.togglePause(true);
    }
    handleVisibilityChange() {
        if (document.hidden) {
            this.handleWindowBlur();
            return;
        }
        if (this.gameRunning && !this.paused && !this.isBlockingGuideOpen()) this.ensureGameLoopRunning();
    }

    handlePointerMove(event) {
        if (!this.gameRunning) return;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;

        const x = (event.clientX - rect.left) * (this.canvas.width / rect.width);
        this.controls.pointerX = this.clamp(x, 0, this.canvas.width);
        this.controls.pointerActive = true;
    }

    handleTouchStart(event) {
        if (!this.gameRunning) return;
        event.preventDefault();
        this.handleTouchMove(event);
        if (this.awaitingLaunch) this.launchBall();
    }

    handleTouchMove(event) {
        if (!this.gameRunning) return;
        event.preventDefault();
        const touch = event.touches[0] || event.changedTouches[0];
        if (!touch) return;

        const rect = this.canvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;

        const x = (touch.clientX - rect.left) * (this.canvas.width / rect.width);
        this.controls.pointerX = this.clamp(x, 0, this.canvas.width);
        this.controls.pointerActive = true;
    }

    handleCanvasInteraction() {
        this.unlockAudio();
        if (this.isBlockingGuideOpen()) {
            this.dismissBlockingGuide();
            return;
        }
        if (!this.gameRunning) {
            this.restart();
            return;
        }
        if (this.paused) {
            this.togglePause(false);
            return;
        }
        if (this.awaitingLaunch) this.launchBall();
    }

    handleVirtualControl(event, isPressed) {
        if (!isPressed) {
            event.preventDefault();
            this.controls.left = false;
            this.controls.right = false;
            return;
        }

        const button = event.target.closest('[data-action]');
        if (!button) return;

        event.preventDefault();
        if (this.isBlockingGuideOpen()) {
            this.dismissBlockingGuide();
            return;
        }
        const action = button.getAttribute('data-action');

        if (action === 'left') {
            this.controls.left = true;
            this.controls.right = false;
            this.controls.pointerActive = false;
        } else if (action === 'right') {
            this.controls.right = true;
            this.controls.left = false;
            this.controls.pointerActive = false;
        } else if (action === 'launch') {
            this.handleCanvasInteraction();
        }
    }

    handleKeyDown(event) {
        this.unlockAudio();
        if (this.isBlockingGuideOpen()) {
            if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'Space') {
                this.dismissBlockingGuide();
                event.preventDefault();
            }
            return;
        }

        if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
            this.controls.left = true;
            this.controls.pointerActive = false;
            event.preventDefault();
            return;
        }

        if (event.code === 'ArrowRight' || event.code === 'KeyD') {
            this.controls.right = true;
            this.controls.pointerActive = false;
            event.preventDefault();
            return;
        }

        if (event.code === 'Space') {
            if (!this.gameRunning) this.restart();
            else if (this.paused) this.togglePause(false);
            else if (this.awaitingLaunch) this.launchBall();
            else this.togglePause(!this.paused);
            event.preventDefault();
            return;
        }

        if (event.code === 'KeyP' || event.code === 'Escape') {
            this.togglePause(!this.paused);
            event.preventDefault();
            return;
        }

        if (event.code === 'KeyM') {
            this.toggleMute();
            event.preventDefault();
            return;
        }

        if (event.code === 'KeyR') {
            this.restart();
            event.preventDefault();
        }
    }

    handleKeyUp(event) {
        if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.controls.left = false;
        if (event.code === 'ArrowRight' || event.code === 'KeyD') this.controls.right = false;
    }

    isBlockingGuideOpen() {
        const guide = document.getElementById('howToPlay');
        if (!guide) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(guide) : null;
        return guide.style.display !== 'none' && (!style || style.display !== 'none');
    }

    dismissBlockingGuide() {
        if (typeof window.dismissHowToPlay === 'function') {
            window.dismissHowToPlay();
            return;
        }
        const guide = document.getElementById('howToPlay');
        if (guide) guide.style.display = 'none';
    }

    togglePause(forceState) {
        if (!this.gameRunning) return;

        if (typeof forceState === 'boolean') this.paused = forceState;
        else this.paused = !this.paused;

        if (this.ui.pauseOverlay) this.ui.pauseOverlay.style.display = this.paused ? 'block' : 'none';
        if (this.paused) {
            this.stopGameLoop();
            this.setStatus('Game paused.');
        } else {
            this.ensureGameLoopRunning();
        }
    }

    ensureGameLoopRunning() {
        if (this.animationFrameId || !this.gameRunning) return;
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    stopGameLoop() {
        if (!this.animationFrameId) return;
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    updatePaddleFromControls() {
        const previousX = this.paddle.x;
        let nextX = this.paddle.x;

        if (this.controls.left || this.controls.right) {
            const direction = (this.controls.right ? 1 : 0) - (this.controls.left ? 1 : 0);
            nextX += direction * this.paddle.speed;
        } else if (this.controls.pointerActive) {
            nextX = this.controls.pointerX - this.paddle.width / 2;
        }

        this.paddle.x = this.clamp(nextX, 0, this.canvas.width - this.paddle.width);
        this.paddle.velocityX = this.paddle.x - previousX;
    }

    updateMovingBlocks() {
        for (let i = 0; i < this.blocks.length; i++) {
            const block = this.blocks[i];
            if (block.type !== 'moving') continue;
            block.driftPhase += block.driftSpeed;
            block.x = block.baseX + Math.sin(block.driftPhase) * block.driftAmount;
        }
    }

    launchBall() {
        if (!this.awaitingLaunch || !this.mainBall) return;

        const speed = this.getBaseBallSpeed();
        const directionalOffset = this.clamp(this.paddle.velocityX * 0.15, -1.6, 1.6);
        let dx = (Math.random() > 0.5 ? 1 : -1) * (speed * 0.45) + directionalOffset;
        if (Math.abs(dx) < 1.3) dx = dx >= 0 ? 1.3 : -1.3;
        const dy = -Math.sqrt(Math.max(1, speed * speed - dx * dx));

        this.mainBall.dx = dx;
        this.mainBall.dy = dy;
        this.mainBall.speed = speed;
        this.awaitingLaunch = false;
        this.setStatus('Ball launched. Keep the chain alive.');
        this.playSound('launch');
    }

    update() {
        if (!this.gameRunning || this.paused) return;

        this.frame++;
        if (this.extraLifeCooldown > 0) this.extraLifeCooldown--;
        this.updatePaddleFromControls();
        this.updateMovingBlocks();

        if (this.awaitingLaunch) {
            if (this.mainBall) {
                this.mainBall.x = this.paddle.x + this.paddle.width / 2;
                this.mainBall.y = this.paddle.y - this.mainBall.radius - 2;
                this.mainBall.dx = 0;
                this.mainBall.dy = 0;
                this.mainBall.trail.length = 0;
            }
        } else {
            this.updateBalls();
        }

        this.updateWaldo();
        this.updateProjectiles();
        this.updatePowerUpDrops();
        this.updateActivePowerUps();
        this.updateComboTimeout();
        this.updateParticles();
        this.updateFloatTexts();
        this.checkLevelCompletion();
        this.checkAchievements();
        this.updateUI();
    }

    updateBalls() {
        const slowFactor = this.activePowerUps.slowMotion ? 0.72 : 1;

        for (let i = this.balls.length - 1; i >= 0; i--) {
            const ball = this.balls[i];
            ball.x += ball.dx * slowFactor;
            ball.y += ball.dy * slowFactor;

            this.appendBallTrail(ball);
            this.applyMagnet(ball);
            this.handleWallCollision(ball);
            this.handlePaddleCollision(ball);
            this.handleBallBlockCollision(ball);

            const shieldActive = !!this.activePowerUps.shield;
            const shieldY = this.canvas.height - this.config.shieldYInset;
            if (shieldActive && ball.y + ball.radius >= shieldY) {
                ball.y = shieldY - ball.radius;
                ball.dy = -Math.abs(ball.dy);
                this.playSound('shield');
                this.screenShake = Math.max(this.screenShake, 6);
                this.shieldHits = Math.max(0, this.shieldHits - 1);
                if (this.shieldHits <= 0) {
                    delete this.activePowerUps.shield;
                    this.setStatus('Shield depleted.');
                }
            }

            if (ball.y - ball.radius > this.canvas.height + 4) {
                this.balls.splice(i, 1);
                if (ball.isMain) {
                    if (this.balls.length > 0) {
                        this.mainBall = this.balls[0];
                        this.mainBall.isMain = true;
                    } else {
                        this.handleLifeLost();
                        break;
                    }
                }
            }
        }
    }

    appendBallTrail(ball) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 14) ball.trail.shift();
    }

    applyMagnet(ball) {
        if (!this.activePowerUps.magnet) return;
        if (ball.y < this.canvas.height * 0.4) return;

        const paddleCenter = this.paddle.x + this.paddle.width / 2;
        const pull = (paddleCenter - ball.x) * 0.015;
        ball.dx += pull;
    }

    handleWallCollision(ball) {
        if (ball.x - ball.radius <= 0) {
            ball.x = ball.radius;
            ball.dx = Math.abs(ball.dx);
            this.playSound('wall');
        } else if (ball.x + ball.radius >= this.canvas.width) {
            ball.x = this.canvas.width - ball.radius;
            ball.dx = -Math.abs(ball.dx);
            this.playSound('wall');
        }

        if (ball.y - ball.radius <= 0) {
            ball.y = ball.radius;
            ball.dy = Math.abs(ball.dy);
            this.playSound('wall');
        }
    }

    handlePaddleCollision(ball) {
        if (ball.dy <= 0) return;

        const top = this.paddle.y;
        const bottom = this.paddle.y + this.paddle.height;
        const left = this.paddle.x;
        const right = this.paddle.x + this.paddle.width;

        if (
            ball.y + ball.radius < top ||
            ball.y - ball.radius > bottom ||
            ball.x + ball.radius < left ||
            ball.x - ball.radius > right
        ) return;

        const hitPos = this.clamp((ball.x - left) / Math.max(1, this.paddle.width), 0, 1);
        const angle = (hitPos - 0.5) * 1.2;
        const speed = Math.max(this.getBaseBallSpeed(), Math.hypot(ball.dx, ball.dy));

        ball.dx = Math.sin(angle) * speed + this.paddle.velocityX * 0.25;
        ball.dy = -Math.abs(Math.cos(angle) * speed);
        if (Math.abs(ball.dx) < 1.1) ball.dx = ball.dx >= 0 ? 1.1 : -1.1;

        ball.y = top - ball.radius;
        this.combo = 0;
        this.comboTimer = 0;
        this.playSound('paddle');
    }

    handleBallBlockCollision(ball) {
        const canPierce = this.activePowerUps.fireBall || (this.activePowerUps.ghostBall && this.ghostCharges > 0);

        for (let i = this.blocks.length - 1; i >= 0; i--) {
            const block = this.blocks[i];
            if (!this.circleRectCollision(ball, block)) continue;

            const damage = this.activePowerUps.fireBall ? 999 : 1;
            this.damageBlock(i, 'ball', damage);

            if (this.activePowerUps.ghostBall && this.ghostCharges > 0) {
                this.ghostCharges--;
                if (this.ghostCharges <= 0) {
                    delete this.activePowerUps.ghostBall;
                    this.setStatus('Ghost charge exhausted.');
                }
            }

            if (!canPierce) {
                this.reflectBallFromBlock(ball, block);
                break;
            }
        }
    }

    circleRectCollision(ball, block) {
        const nearestX = this.clamp(ball.x, block.x, block.x + block.width);
        const nearestY = this.clamp(ball.y, block.y, block.y + block.height);
        const dx = ball.x - nearestX;
        const dy = ball.y - nearestY;
        return (dx * dx + dy * dy) <= ball.radius * ball.radius;
    }

    reflectBallFromBlock(ball, block) {
        const overlapLeft = ball.x + ball.radius - block.x;
        const overlapRight = block.x + block.width - (ball.x - ball.radius);
        const overlapTop = ball.y + ball.radius - block.y;
        const overlapBottom = block.y + block.height - (ball.y - ball.radius);

        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
        if (minOverlap === overlapLeft) {
            ball.x = block.x - ball.radius;
            ball.dx = -Math.abs(ball.dx);
        } else if (minOverlap === overlapRight) {
            ball.x = block.x + block.width + ball.radius;
            ball.dx = Math.abs(ball.dx);
        } else if (minOverlap === overlapTop) {
            ball.y = block.y - ball.radius;
            ball.dy = -Math.abs(ball.dy);
        } else {
            ball.y = block.y + block.height + ball.radius;
            ball.dy = Math.abs(ball.dy);
        }
    }

    handleLifeLost() {
        this.levelMistakes++;
        this.lives--;
        this.combo = 0;
        this.comboTimer = 0;
        this.screenShake = 14;
        this.playSound('loseLife');

        if (this.lives <= 0) {
            this.gameOver();
            return;
        }

        this.awaitingLaunch = true;
        this.activePowerUps = {};
        this.ghostCharges = 0;
        this.shieldHits = 0;
        this.projectiles = [];
        this.powerUpDrops = [];
        this.resetPaddleSize();
        this.spawnMainBall();
        this.setStatus('Life lost. Relaunch when ready.');
    }

    checkLevelCompletion() {
        if (this.blocks.length > 0) return;

        const perfect = this.levelMistakes === 0;
        const bonus = 120 * this.level;
        const perfectBonus = perfect ? 180 : 0;
        this.score += bonus + perfectBonus;

        this.spawnFloatText(`LEVEL +${bonus}`, this.canvas.width / 2, this.canvas.height / 2, '#8effb4');
        if (perfect) {
            this.perfectLevels++;
            this.spawnFloatText('PERFECT LEVEL', this.canvas.width / 2, this.canvas.height / 2 - 28, '#ffe08a');
        }

        if (this.level >= this.config.maxLevel) {
            this.playSound('victory');
            this.screenShake = 24;
            this.setStatus(`Level ${this.config.maxLevel} cleared. Chaos mastered.`);
            this.gameOver(true);
            return;
        }

        this.playSound('level');
        this.level++;
        this.screenShake = 18;
        this.setStatus(`Level ${this.level - 1} complete. Next wave incoming.`);
        this.setupLevel();
    }

    gameOver(won) {
        const isWin = !!won;
        this.gameRunning = false;
        this.gameWon = isWin;
        this.paused = false;
        if (!isWin) this.playSound('gameOver');

        if (this.ui.gameOver) this.ui.gameOver.style.display = 'block';
        if (this.ui.pauseOverlay) this.ui.pauseOverlay.style.display = 'none';
        if (this.ui.finalScore) this.ui.finalScore.textContent = String(this.score);
        if (this.ui.endTitle) this.ui.endTitle.textContent = isWin ? 'Level 69 Cleared' : 'Run Over';
        if (this.ui.endSubtitle) {
            this.ui.endSubtitle.textContent = isWin
                ? 'You beat the full chaos ladder. Toilet throne secured.'
                : 'The run got flushed. Reload your luck.';
        }

        this.setStatus(isWin ? `Victory! You conquered level ${this.config.maxLevel}.` : 'Run ended. Hit restart to run it back.');
        this.checkAchievements();
        this.savePersistentData();
        this.updateUI();
    }

    restart() {
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.combo = 0;
        this.comboTimer = 0;
        this.runBestCombo = 0;
        this.levelMistakes = 0;
        this.gameRunning = true;
        this.gameWon = false;
        this.paused = false;
        this.awaitingLaunch = true;
        this.screenShake = 0;
        this.frame = 0;
        this.runSeed = this.createRunSeed();
        this.extraLifeCooldown = 0;
        this.blocksSinceDrop = 0;
        this.waldo = null;
        this.levelLayoutSignatures = new Set();
        this.levelLayoutSignature = '';

        this.activePowerUps = {};
        this.ghostCharges = 0;
        this.shieldHits = 0;
        this.projectiles = [];
        this.powerUpDrops = [];
        this.floatTexts = [];
        this.particles = this.particles.filter((particle) => particle.ambient);

        this.resetPaddleSize();
        this.setupLevel();

        if (this.ui.gameOver) this.ui.gameOver.style.display = 'none';
        if (this.ui.pauseOverlay) this.ui.pauseOverlay.style.display = 'none';
        if (this.ui.endTitle) this.ui.endTitle.textContent = 'Run Over';
        if (this.ui.endSubtitle) this.ui.endSubtitle.textContent = 'The run got flushed. Reload your luck.';

        this.setStatus('Fresh run started.');
        this.ensureGameLoopRunning();
    }
    damageBlock(index, source, damage) {
        const block = this.blocks[index];
        if (!block) return;

        block.health -= damage;

        if (block.health > 0) {
            this.playSound('armor');
            this.spawnHitParticles(block, 4);
            this.screenShake = Math.max(this.screenShake, 2);
            return;
        }

        this.blocks.splice(index, 1);
        this.totalBlocksBroken++;
        this.combo++;
        this.comboTimer = this.config.comboTimeoutFrames;
        this.runBestCombo = Math.max(this.runBestCombo, this.combo);

        const comboMult = 1 + Math.min(2.8, this.combo * 0.12);
        const boost = this.activePowerUps.scoreBoost ? 1.8 : 1;
        const sourcePenalty = source === 'projectile' ? 0.9 : 1;
        const gain = Math.floor(block.value * comboMult * boost * sourcePenalty);

        this.score += gain;
        this.spawnFloatText(`+${gain}`, block.x + block.width / 2, block.y + block.height / 2, block.color);
        this.spawnBurstParticles(block);
        this.playSound('block');

        if (block.type === 'explosive') {
            this.applySplashDamage(block.x + block.width / 2, block.y + block.height / 2, 88, 1);
            this.screenShake = Math.max(this.screenShake, 7);
        }

        this.blocksSinceDrop++;
        const droughtBoost = Math.min(this.config.droughtCap, this.blocksSinceDrop * this.config.droughtPerBlock);
        const baseDropChance = Math.min(
            this.config.maxDropChance,
            this.config.blockDropChance * 0.35 + this.level * this.config.dropChancePerLevel + droughtBoost
        );
        const dropEligible = this.powerUpDrops.length === 0 && this.balls.length <= 1;
        if (block.type === 'elite') {
            this.createPowerUpDrop(block.x + block.width / 2, block.y + block.height / 2, true);
            this.blocksSinceDrop = 0;
        } else if (dropEligible && block.type !== 'armored' && Math.random() < baseDropChance) {
            this.createPowerUpDrop(block.x + block.width / 2, block.y + block.height / 2, false);
            this.blocksSinceDrop = 0;
        }
    }

    applySplashDamage(centerX, centerY, radius, damage) {
        for (let i = this.blocks.length - 1; i >= 0; i--) {
            const block = this.blocks[i];
            const bx = block.x + block.width / 2;
            const by = block.y + block.height / 2;
            const distance = Math.hypot(centerX - bx, centerY - by);
            if (distance <= radius) this.damageBlock(i, 'explosion', damage);
        }
    }

    getPowerUpCatalog() {
        return [
            { type: 'toiletPaper', name: 'Paper Cannon', color: '#f6f7fb', symbol: 'TP', duration: 520, weight: 7 },
            { type: 'multiBall', name: 'Multi Ball', color: '#ff9f7b', symbol: 'MB', duration: 0, weight: 6 },
            { type: 'bigPaddle', name: 'Wide Paddle', color: '#7ffff0', symbol: 'W', duration: 760, weight: 6 },
            { type: 'smallPaddle', name: 'Tiny Paddle', color: '#ffd17c', symbol: 'S', duration: 540, weight: 3 },
            { type: 'slowMotion', name: 'Slow Motion', color: '#7bc8ff', symbol: 'SL', duration: 620, weight: 6 },
            { type: 'extraLife', name: 'Extra Life', color: '#ff8ea8', symbol: 'L+', duration: 0, weight: 1.4 },
            { type: 'laser', name: 'Twin Laser', color: '#ff7afe', symbol: 'LZ', duration: 560, weight: 7 },
            { type: 'magnet', name: 'Magnet', color: '#90f2b1', symbol: 'MG', duration: 680, weight: 6 },
            { type: 'ghostBall', name: 'Ghost Charge', color: '#c8b8ff', symbol: 'GH', duration: 420, weight: 5 },
            { type: 'fireBall', name: 'Fire Ball', color: '#ff764f', symbol: 'FB', duration: 430, weight: 5 },
            { type: 'shield', name: 'Bottom Shield', color: '#67d7ff', symbol: 'SH', duration: 620, weight: 5 },
            { type: 'scoreBoost', name: 'Score Boost', color: '#ffe17d', symbol: '2X', duration: 540, weight: 5 },
            { type: 'overdrive', name: 'Overdrive', color: '#ff9aff', symbol: 'OD', duration: 460, weight: 4 }
        ];
    }

    selectPowerUp(forceStrong) {
        const catalog = this.getPowerUpCatalog();
        let pool = forceStrong ? catalog.filter((item) => item.type !== 'smallPaddle') : catalog;
        pool = pool.filter((item) => {
            if (item.type !== 'extraLife') return true;
            if (this.extraLifeCooldown > 0) return false;
            if (this.lives >= 7) return false;
            if (this.level < 6 && this.lives >= 4) return false;
            return true;
        });
        if (pool.length === 0) pool = catalog.filter((item) => item.type !== 'extraLife');
        let total = 0;
        for (let i = 0; i < pool.length; i++) total += pool[i].weight;

        let roll = Math.random() * total;
        for (let i = 0; i < pool.length; i++) {
            roll -= pool[i].weight;
            if (roll <= 0) return pool[i];
        }
        return pool[0];
    }

    createPowerUpDrop(x, y, forceStrong) {
        if (this.powerUpDrops.length >= 1) return;
        if (this.balls.length > 1) return;
        const selected = this.selectPowerUp(forceStrong);

        this.powerUpDrops.push({
            x,
            y,
            vy: 2.2,
            width: 28,
            height: 28,
            rotation: 0,
            data: selected
        });
    }

    updatePowerUpDrops() {
        for (let i = this.powerUpDrops.length - 1; i >= 0; i--) {
            const drop = this.powerUpDrops[i];
            drop.y += drop.vy;
            drop.rotation += 0.06;

            const left = drop.x - drop.width / 2;
            const right = drop.x + drop.width / 2;

            if (
                drop.y + drop.height / 2 >= this.paddle.y &&
                drop.y - drop.height / 2 <= this.paddle.y + this.paddle.height &&
                right >= this.paddle.x &&
                left <= this.paddle.x + this.paddle.width
            ) {
                this.activatePowerUp(drop.data);
                this.powerUpDrops.splice(i, 1);
                continue;
            }

            if (drop.y - drop.height > this.canvas.height) this.powerUpDrops.splice(i, 1);
        }
    }

    activatePowerUp(powerUp) {
        if (!powerUp) return;
        this.powerUpsCollected++;
        this.playSound('powerUp');

        const setTimer = (type, duration) => {
            this.activePowerUps[type] = Math.max(this.activePowerUps[type] || 0, duration);
        };

        switch (powerUp.type) {
            case 'toiletPaper':
                setTimer('toiletPaper', powerUp.duration || this.config.defaultPowerDuration);
                break;
            case 'multiBall':
                this.spawnExtraBalls(2);
                break;
            case 'bigPaddle':
                delete this.activePowerUps.smallPaddle;
                setTimer('bigPaddle', powerUp.duration || 700);
                this.applyPaddleSizeModifiers();
                break;
            case 'smallPaddle':
                delete this.activePowerUps.bigPaddle;
                setTimer('smallPaddle', powerUp.duration || 500);
                this.applyPaddleSizeModifiers();
                break;
            case 'slowMotion':
                setTimer('slowMotion', powerUp.duration || 620);
                break;
            case 'extraLife':
                this.lives = Math.min(9, this.lives + 1);
                this.extraLifeCooldown = Math.max(this.extraLifeCooldown, NEON_BALANCE.power.extraLifeCooldown);
                this.spawnFloatText('LIFE +1', this.paddle.x + this.paddle.width / 2, this.paddle.y - 18, '#ff9ab3');
                break;
            case 'laser':
                setTimer('laser', powerUp.duration || 560);
                break;
            case 'magnet':
                setTimer('magnet', powerUp.duration || 640);
                break;
            case 'ghostBall':
                setTimer('ghostBall', powerUp.duration || 420);
                this.ghostCharges = Math.max(this.ghostCharges, 9);
                break;
            case 'fireBall':
                setTimer('fireBall', powerUp.duration || 420);
                break;
            case 'shield':
                setTimer('shield', powerUp.duration || 620);
                this.shieldHits = 2 + Math.floor(this.level / 6);
                break;
            case 'scoreBoost':
                setTimer('scoreBoost', powerUp.duration || 520);
                break;
            case 'overdrive':
                setTimer('overdrive', powerUp.duration || 460);
                for (let i = 0; i < this.balls.length; i++) {
                    const b = this.balls[i];
                    const speed = Math.hypot(b.dx, b.dy) || this.getBaseBallSpeed();
                    const targetSpeed = Math.min(this.config.maxBallSpeed, speed + 1.4);
                    const norm = Math.max(0.001, speed);
                    b.dx = (b.dx / norm) * targetSpeed;
                    b.dy = (b.dy / norm) * targetSpeed;
                }
                break;
            default:
                break;
        }

        this.setStatus(`Power-up: ${powerUp.name}`);
    }

    spawnExtraBalls(count) {
        if (!this.mainBall) return;

        const maxBalls = 6;
        const slots = Math.max(0, maxBalls - this.balls.length);
        const createCount = Math.min(count, slots);
        const speed = this.getBaseBallSpeed();

        for (let i = 0; i < createCount; i++) {
            const spread = ((i + 1) / (createCount + 1)) * 1.2 - 0.6;
            const dx = this.mainBall.dx + spread * speed;
            const dy = -Math.abs(this.mainBall.dy || speed);
            const extra = this.createBall(this.mainBall.x, this.mainBall.y, dx, dy, false);
            this.balls.push(extra);
        }
    }

    applyPaddleSizeModifiers() {
        if (this.activePowerUps.bigPaddle) this.paddle.width = Math.round(this.paddleBaseWidth * 1.55);
        else if (this.activePowerUps.smallPaddle) this.paddle.width = Math.round(this.paddleBaseWidth * 0.68);
        else this.paddle.width = this.paddleBaseWidth;

        this.paddle.x = this.clamp(this.paddle.x, 0, this.canvas.width - this.paddle.width);
    }

    updateProjectiles() {
        if (this.activePowerUps.laser && this.frame % 10 === 0) {
            const y = this.paddle.y;
            this.projectiles.push({ x: this.paddle.x + 8, y, width: 4, height: 16, vy: -12, color: '#ff87ff', damage: 1, kind: 'laser' });
            this.projectiles.push({ x: this.paddle.x + this.paddle.width - 12, y, width: 4, height: 16, vy: -12, color: '#ff87ff', damage: 1, kind: 'laser' });
        }

        if (this.activePowerUps.toiletPaper && this.frame % 20 === 0) {
            this.projectiles.push({
                x: this.paddle.x + this.paddle.width / 2 - 8,
                y: this.paddle.y,
                width: 16,
                height: 16,
                vy: -8,
                color: '#ffffff',
                damage: 2,
                kind: 'paper',
                rotation: 0
            });
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const shot = this.projectiles[i];
            shot.y += shot.vy;
            if (shot.rotation !== undefined) shot.rotation += 0.2;

            let collided = false;
            for (let j = this.blocks.length - 1; j >= 0; j--) {
                const block = this.blocks[j];
                if (
                    shot.x + shot.width > block.x &&
                    shot.x < block.x + block.width &&
                    shot.y + shot.height > block.y &&
                    shot.y < block.y + block.height
                ) {
                    this.damageBlock(j, 'projectile', shot.damage);
                    collided = true;
                    break;
                }
            }

            if (collided || shot.y + shot.height < 0) this.projectiles.splice(i, 1);
        }

        if (this.projectiles.length > 60) this.projectiles.splice(0, this.projectiles.length - 60);
    }

    updateActivePowerUps() {
        const types = Object.keys(this.activePowerUps);
        for (let i = 0; i < types.length; i++) {
            const type = types[i];
            this.activePowerUps[type]--;
            if (this.activePowerUps[type] <= 0) {
                delete this.activePowerUps[type];
                if (type === 'bigPaddle' || type === 'smallPaddle') this.applyPaddleSizeModifiers();
                if (type === 'ghostBall') this.ghostCharges = 0;
            }
        }

        this.applyPaddleSizeModifiers();
    }

    updateComboTimeout() {
        if (this.combo <= 0) return;
        this.comboTimer--;
        if (this.comboTimer <= 0) {
            this.combo = 0;
            this.comboTimer = 0;
        }
    }

    createAmbientParticles() {
        this.ambientParticles = [];
        const count = 70;
        for (let i = 0; i < count; i++) {
            this.ambientParticles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: 1 + Math.random() * 2,
                alpha: 0.2 + Math.random() * 0.45,
                drift: 0.1 + Math.random() * 0.5,
                twinkle: Math.random() * Math.PI * 2,
                ambient: true
            });
        }
    }

    spawnHitParticles(block, amount) {
        for (let i = 0; i < amount; i++) {
            this.particles.push({
                x: block.x + Math.random() * block.width,
                y: block.y + Math.random() * block.height,
                vx: (Math.random() - 0.5) * 3,
                vy: (Math.random() - 0.5) * 3,
                life: 20 + Math.random() * 12,
                size: 1 + Math.random() * 2,
                color: block.color
            });
        }
    }

    spawnBurstParticles(block) {
        for (let i = 0; i < 10; i++) {
            this.particles.push({
                x: block.x + block.width / 2,
                y: block.y + block.height / 2,
                vx: (Math.random() - 0.5) * 7,
                vy: (Math.random() - 0.5) * 7,
                life: 30 + Math.random() * 20,
                size: 2 + Math.random() * 3,
                color: block.color
            });
        }

        if (this.particles.length > this.config.maxParticles) {
            this.particles.splice(0, this.particles.length - this.config.maxParticles);
        }
    }

    spawnFloatText(text, x, y, color) {
        this.floatTexts.push({ text, x, y, vy: -0.6, life: 64, color });
        if (this.floatTexts.length > 18) this.floatTexts.splice(0, this.floatTexts.length - 18);
    }

    updateParticles() {
        for (let i = 0; i < this.ambientParticles.length; i++) {
            const p = this.ambientParticles[i];
            p.y -= p.drift;
            p.twinkle += 0.02;
            if (p.y < -4) {
                p.y = this.canvas.height + 4;
                p.x = Math.random() * this.canvas.width;
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            if (p.ambient) continue;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.03;
            p.life--;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    updateFloatTexts() {
        for (let i = this.floatTexts.length - 1; i >= 0; i--) {
            const text = this.floatTexts[i];
            text.y += text.vy;
            text.life--;
            if (text.life <= 0) this.floatTexts.splice(i, 1);
        }
    }
    drawBackground() {
        const t = this.frame * 0.005;
        const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, `hsl(${210 + Math.sin(t) * 10}, 48%, 10%)`);
        gradient.addColorStop(0.5, `hsl(${245 + Math.cos(t * 0.9) * 12}, 42%, 14%)`);
        gradient.addColorStop(1, `hsl(${190 + Math.sin(t * 1.2) * 8}, 55%, 9%)`);

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.strokeStyle = 'rgba(126, 245, 220, 0.08)';
        this.ctx.lineWidth = 1;

        for (let x = 0; x <= this.canvas.width; x += 40) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        for (let y = 0; y <= this.canvas.height; y += 40) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }

        for (let i = 0; i < this.ambientParticles.length; i++) {
            const p = this.ambientParticles[i];
            const alpha = p.alpha + Math.sin(p.twinkle) * 0.12;
            this.ctx.fillStyle = `rgba(145, 240, 255, ${this.clamp(alpha, 0.05, 0.75)})`;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawBlocks() {
        for (let i = 0; i < this.blocks.length; i++) {
            const block = this.blocks[i];
            const healthRatio = this.clamp(block.health / block.maxHealth, 0, 1);

            this.ctx.save();
            this.ctx.fillStyle = block.color;
            this.ctx.globalAlpha = 0.85;
            this.drawRoundedRect(block.x, block.y, block.width, block.height, 6);
            this.ctx.fill();

            this.ctx.lineWidth = block.type === 'elite' ? 3 : 2;
            this.ctx.strokeStyle = block.type === 'explosive' ? '#ffd0c8' : 'rgba(255, 255, 255, 0.55)';
            this.ctx.shadowBlur = block.type === 'moving' ? 20 : 12;
            this.ctx.shadowColor = block.color;
            this.ctx.stroke();

            if (block.type === 'explosive') {
                this.ctx.fillStyle = 'rgba(255, 245, 210, 0.85)';
                this.ctx.font = 'bold 12px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('X', block.x + block.width / 2, block.y + block.height / 2 + 4);
            } else if (block.type === 'elite') {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                this.ctx.font = 'bold 11px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('E', block.x + block.width / 2, block.y + block.height / 2 + 4);
            }

            if (healthRatio < 1) {
                this.ctx.fillStyle = 'rgba(10, 14, 24, 0.72)';
                this.ctx.fillRect(block.x + 3, block.y + block.height - 6, block.width - 6, 3);
                this.ctx.fillStyle = '#ff718e';
                this.ctx.fillRect(block.x + 3, block.y + block.height - 6, (block.width - 6) * healthRatio, 3);
            }

            this.ctx.restore();
        }
    }

    drawWaldo() {
        if (!this.waldo || !this.waldo.active) return;

        const waldo = this.waldo;
        const s = waldo.size;
        const x = waldo.x;
        const y = waldo.y;
        const stripeAlpha = 0.7 + Math.sin(waldo.blink) * 0.2;

        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.globalAlpha = 0.95;

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        this.ctx.beginPath();
        this.ctx.ellipse(0, s * 0.54, s * 0.42, s * 0.14, 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#ffd8b1';
        this.ctx.beginPath();
        this.ctx.arc(0, -s * 0.38, s * 0.19, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(-s * 0.26, -s * 0.18, s * 0.52, s * 0.46);
        this.ctx.fillStyle = `rgba(220, 45, 55, ${stripeAlpha})`;
        for (let i = 0; i < 4; i++) {
            this.ctx.fillRect(-s * 0.26, -s * 0.17 + i * (s * 0.11), s * 0.52, s * 0.055);
        }

        this.ctx.fillStyle = '#4974d3';
        this.ctx.fillRect(-s * 0.22, s * 0.26, s * 0.44, s * 0.22);

        this.ctx.fillStyle = '#dd2d37';
        this.ctx.fillRect(-s * 0.22, -s * 0.58, s * 0.44, s * 0.12);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(-s * 0.22, -s * 0.52, s * 0.44, s * 0.055);
        this.ctx.fillStyle = '#dd2d37';
        this.ctx.fillRect(-s * 0.22, -s * 0.475, s * 0.44, s * 0.055);

        this.ctx.strokeStyle = '#2d394f';
        this.ctx.lineWidth = 1.4;
        this.ctx.beginPath();
        this.ctx.arc(-s * 0.07, -s * 0.395, s * 0.038, 0, Math.PI * 2);
        this.ctx.arc(s * 0.07, -s * 0.395, s * 0.038, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        this.ctx.font = 'bold 11px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('?', 0, -s * 0.82);
        this.ctx.restore();
    }

    drawPaddle() {
        this.ctx.save();
        const gradient = this.ctx.createLinearGradient(this.paddle.x, this.paddle.y, this.paddle.x, this.paddle.y + this.paddle.height);
        gradient.addColorStop(0, '#9bffe7');
        gradient.addColorStop(1, '#42d6c8');

        this.ctx.fillStyle = gradient;
        this.ctx.shadowBlur = 16;
        this.ctx.shadowColor = '#72fff0';
        this.drawRoundedRect(this.paddle.x, this.paddle.y, this.paddle.width, this.paddle.height, 8);
        this.ctx.fill();

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.fillRect(this.paddle.x + 8, this.paddle.y + 3, Math.max(12, this.paddle.width * 0.35), 2);
        this.ctx.restore();

        if (this.activePowerUps.shield) {
            const y = this.canvas.height - this.config.shieldYInset;
            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(103, 215, 255, 0.95)';
            this.ctx.lineWidth = 3;
            this.ctx.shadowBlur = 18;
            this.ctx.shadowColor = '#67d7ff';
            this.ctx.beginPath();
            this.ctx.moveTo(20, y);
            this.ctx.lineTo(this.canvas.width - 20, y);
            this.ctx.stroke();
            this.ctx.fillStyle = '#c5efff';
            this.ctx.font = '12px Arial';
            this.ctx.fillText(`Shield ${Math.max(0, this.shieldHits)}`, 24, y - 8);
            this.ctx.restore();
        }
    }

    drawBalls() {
        for (let i = 0; i < this.balls.length; i++) {
            const ball = this.balls[i];
            for (let j = 0; j < ball.trail.length; j++) {
                const point = ball.trail[j];
                const alpha = (j + 1) / ball.trail.length * 0.35;
                const radius = Math.max(1, ball.radius * (j + 1) / ball.trail.length * 0.9);
                this.ctx.fillStyle = `rgba(255, 210, 144, ${alpha.toFixed(3)})`;
                this.ctx.beginPath();
                this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.ctx.save();
            this.ctx.fillStyle = this.activePowerUps.fireBall ? '#ff6b45' : ball.color;
            this.ctx.shadowBlur = this.activePowerUps.fireBall ? 22 : 16;
            this.ctx.shadowColor = this.activePowerUps.fireBall ? '#ff6b45' : '#ffd3a3';
            this.ctx.beginPath();
            this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    drawPowerUps() {
        for (let i = 0; i < this.powerUpDrops.length; i++) {
            const drop = this.powerUpDrops[i];
            this.ctx.save();
            this.ctx.translate(drop.x, drop.y);
            this.ctx.rotate(drop.rotation);
            this.ctx.fillStyle = drop.data.color;
            this.ctx.shadowBlur = 12;
            this.ctx.shadowColor = drop.data.color;
            this.drawRoundedRect(-14, -14, 28, 28, 7);
            this.ctx.fill();

            this.ctx.fillStyle = '#1d2238';
            this.ctx.font = 'bold 11px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(drop.data.symbol, 0, 1);
            this.ctx.restore();
        }
    }

    drawProjectiles() {
        for (let i = 0; i < this.projectiles.length; i++) {
            const shot = this.projectiles[i];
            this.ctx.save();
            if (shot.kind === 'paper') {
                this.ctx.translate(shot.x + shot.width / 2, shot.y + shot.height / 2);
                this.ctx.rotate(shot.rotation || 0);
                this.ctx.fillStyle = '#ffffff';
                this.ctx.shadowBlur = 7;
                this.ctx.shadowColor = '#ffffff';
                this.drawRoundedRect(-shot.width / 2, -shot.height / 2, shot.width, shot.height, 4);
                this.ctx.fill();
            } else {
                this.ctx.fillStyle = shot.color;
                this.ctx.shadowBlur = 10;
                this.ctx.shadowColor = shot.color;
                this.ctx.fillRect(shot.x, shot.y, shot.width, shot.height);
            }
            this.ctx.restore();
        }
    }

    drawParticles() {
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.ambient) continue;
            const alpha = this.clamp(p.life / 50, 0, 1);
            this.ctx.fillStyle = this.hexToRgba(p.color || '#ffffff', alpha);
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawFloatTexts() {
        for (let i = 0; i < this.floatTexts.length; i++) {
            const text = this.floatTexts[i];
            const alpha = this.clamp(text.life / 64, 0, 1);
            this.ctx.fillStyle = this.hexToRgba(text.color || '#ffffff', alpha);
            this.ctx.font = 'bold 16px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(text.text, text.x, text.y);
        }
    }

    drawHUDOverlay() {
        const activeTypes = Object.keys(this.activePowerUps);
        if (activeTypes.length === 0) return;

        const catalog = this.getPowerUpCatalog();
        let y = 26;
        const maxRows = 6;

        for (let i = 0; i < activeTypes.length && i < maxRows; i++) {
            const type = activeTypes[i];
            const data = catalog.find((entry) => entry.type === type);
            if (!data) continue;
            const seconds = Math.ceil(this.activePowerUps[type] / 60);

            this.ctx.fillStyle = 'rgba(6, 12, 22, 0.6)';
            this.drawRoundedRect(10, y - 16, 166, 20, 6);
            this.ctx.fill();
            this.ctx.fillStyle = data.color;
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(`${data.symbol} ${data.name} (${seconds}s)`, 16, y - 2);
            y += 24;
        }
    }

    checkAchievements() {
        this.tryUnlockAchievement('score_5000', 'Score Sprinter', this.score >= 5000);
        this.tryUnlockAchievement('score_15000', 'Neon Grinder', this.score >= 15000);
        this.tryUnlockAchievement('combo_8', 'Combo Crafter', this.runBestCombo >= 8);
        this.tryUnlockAchievement('level_6', 'Deep Runner', this.level >= 6);
        this.tryUnlockAchievement('level_69', 'Chaos Crown', this.gameWon || this.level >= this.config.maxLevel);
        this.tryUnlockAchievement('powerup_20', 'Collector', this.powerUpsCollected >= 20);
        this.tryUnlockAchievement('perfect_2', 'No Mistakes', this.perfectLevels >= 2);
    }

    tryUnlockAchievement(id, label, condition) {
        if (!condition || this.achievements[id]) return;

        this.achievements[id] = { label, unlockedAt: Date.now() };
        this.playSound('achievement');
        this.showAchievementToast(label);
        this.setStatus(`Achievement unlocked: ${label}`);
        this.savePersistentData();
    }

    showAchievementToast(label) {
        if (!this.ui.achievementToast) return;

        this.ui.achievementToast.textContent = `Achievement: ${label}`;
        this.ui.achievementToast.classList.add('show');

        clearTimeout(this.toastTimeoutId);
        this.toastTimeoutId = setTimeout(() => {
            if (this.ui.achievementToast) this.ui.achievementToast.classList.remove('show');
        }, 2600);
    }

    updateUI() {
        if (this.score > this.highScore) this.highScore = this.score;
        this.bestCombo = Math.max(this.bestCombo, this.runBestCombo);

        if (this.ui.score) this.ui.score.textContent = String(this.score);
        if (this.ui.highScore) this.ui.highScore.textContent = String(this.highScore);
        if (this.ui.lives) this.ui.lives.textContent = String(this.lives);
        if (this.ui.level) this.ui.level.textContent = `${this.level}/${this.config.maxLevel}`;
        if (this.ui.combo) this.ui.combo.textContent = String(this.combo);
        if (this.ui.bestCombo) this.ui.bestCombo.textContent = String(this.bestCombo);

        if (this.ui.comboDisplay) this.ui.comboDisplay.style.display = this.combo > 1 ? 'block' : 'none';

        if (this.ui.activePowerList) {
            const active = Object.keys(this.activePowerUps);
            const catalog = this.getPowerUpCatalog();
            if (active.length === 0) {
                this.ui.activePowerList.innerHTML = '<span class="power-chip">None</span>';
            } else {
                this.ui.activePowerList.innerHTML = active.slice(0, 8).map((type) => {
                    const data = catalog.find((entry) => entry.type === type);
                    if (!data) return '';
                    const seconds = Math.ceil(this.activePowerUps[type] / 60);
                    return `<span class="power-chip" style="border-color:${data.color};color:${data.color}">${data.symbol} ${seconds}s</span>`;
                }).join('');
            }
        }

        if (this.ui.achievementsList) {
            const unlocked = Object.keys(this.achievements).length;
            this.ui.achievementsList.textContent = `${unlocked} unlocked`;
        }

        // updateUI() runs every frame; throttle localStorage writes to ~1/sec.
        // Important moments (game over, achievements) call savePersistentData()
        // directly, so nothing meaningful is lost between throttled writes.
        const now = Date.now();
        if (!this.lastPersistAt || now - this.lastPersistAt >= 1000) {
            this.lastPersistAt = now;
            this.savePersistentData();
        }
    }

    render() {
        if (!this.ctx) return;

        this.ctx.save();
        if (this.screenShake > 0) {
            const x = (Math.random() - 0.5) * 6;
            const y = (Math.random() - 0.5) * 6;
            this.ctx.translate(x, y);
            this.screenShake--;
        }

        this.drawBackground();
        this.drawBlocks();
        this.drawWaldo();
        this.drawPaddle();
        this.drawBalls();
        this.drawPowerUps();
        this.drawProjectiles();
        this.drawParticles();
        this.drawFloatTexts();
        this.drawHUDOverlay();

        if (this.awaitingLaunch && this.gameRunning && !this.paused) {
            this.ctx.fillStyle = 'rgba(230, 250, 255, 0.92)';
            this.ctx.font = 'bold 18px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('Press Space / Tap to Launch', this.canvas.width / 2, this.canvas.height - 72);
        }

        this.ctx.restore();
    }

    savePersistentData() {
        try {
            localStorage.setItem('neonArkanoidHighScore', String(this.highScore));
            localStorage.setItem('neonArkanoidBestCombo', String(this.bestCombo));
            localStorage.setItem('neonArkanoidBlocksBroken', String(this.totalBlocksBroken));
            localStorage.setItem('neonArkanoidPowerUpsCollected', String(this.powerUpsCollected));
            localStorage.setItem('neonArkanoidPerfectLevels', String(this.perfectLevels));
            localStorage.setItem('neonArkanoidAchievements', JSON.stringify(this.achievements));
        } catch (error) {}
    }

    readNumber(key, fallback) {
        try {
            const parsed = parseInt(localStorage.getItem(key) || '', 10);
            return Number.isFinite(parsed) ? parsed : fallback;
        } catch (error) {
            return fallback;
        }
    }

    readObject(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
            return fallback;
        } catch (error) {
            return fallback;
        }
    }

    drawRoundedRect(x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + width - r, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        this.ctx.lineTo(x + width, y + height - r);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        this.ctx.lineTo(x + r, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }

    hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(255,255,255,${alpha})`;

        const sanitized = hex.replace('#', '');
        if (sanitized.length !== 6) return `rgba(255,255,255,${alpha})`;

        const r = parseInt(sanitized.slice(0, 2), 16);
        const g = parseInt(sanitized.slice(2, 4), 16);
        const b = parseInt(sanitized.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    checkCollision(ball, block) {
        return this.circleRectCollision(ball, block);
    }

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    gameLoop() {
        this.animationFrameId = null;
        try {
            this.update();
            this.render();
        } catch (error) {
            console.error('Game loop error:', error);
        }
        if (this.gameRunning && !this.paused) this.ensureGameLoopRunning();
    }
}

let gameInstance = null;
window.addEventListener('load', () => {
    try {
        gameInstance = new Game();
        window.gameInstance = gameInstance;
    } catch (error) {
        console.error('Failed to initialize game:', error);
        gameInstance = null;
        window.gameInstance = null;
    }
});

function restartGame() {
    const instance = window.gameInstance || gameInstance;
    if (instance) instance.restart();
    else location.reload();
}

function togglePause() {
    const instance = window.gameInstance || gameInstance;
    if (instance && instance.togglePause) instance.togglePause();
}

function toggleMute() {
    const instance = window.gameInstance || gameInstance;
    if (instance && instance.toggleMute) instance.toggleMute();
}

