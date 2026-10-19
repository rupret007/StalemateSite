// Stand-in for https://www.youtube.com/iframe_api so sync tests are deterministic and offline.
window.__ytLog = [];
window.__ytEmbeds = [];
window.YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: function FakePlayer(el, opts) {
        const node = typeof el === 'string' ? document.getElementById(el) : el;
        window.__ytEmbeds.push({ tagName: node.tagName, id: node.id,
            src: node.getAttribute('src'), referrerPolicy: node.referrerPolicy || '',
            allow: node.getAttribute('allow'), allowFullscreen: node.hasAttribute('allowfullscreen'),
            attributes: Object.fromEntries([...node.attributes].map(({ name, value }) => [name, value])) });
        let videoId = opts.videoId;
        if (node.tagName === 'IFRAME') {
            const embed = new URL(node.src, location.href);
            videoId = /^\/embed\/([A-Za-z0-9_-]{11})$/.exec(embed.pathname)?.[1] || '';
        }
        const box = document.createElement('div');
        for (const attr of node.attributes) box.setAttribute(attr.name, attr.value);
        box.dataset.fakeYt = '';
        box.style.background = '#333';
        node.replaceWith(box);
        let base = 0;
        let started = null;
        let playerState = 2;
        // Opt-in policy fixture only. Real playVideo() returns void, including
        // when browser policy blocks playback; the API reports that separately.
        // Existing suites keep their original immediate-play behavior.
        const policy = window.__ytAutoplayControl || null;
        const now = () => performance.now() / 1000;
        const time = () => (started === null ? base : base + (now() - started));
        const syncState = () => { playerState = started === null ? 2 : 1; };
        const emit = (state) => {
            playerState = state;
            opts.events && opts.events.onStateChange && opts.events.onStateChange({ target: this, data: state });
        };
        const render = () => {
            syncState();
            box.dataset.videoId = videoId;
            box.dataset.state = playerState === 1 ? 'playing' : 'paused';
            box.textContent = `YT ${videoId}`;
        };
        this.getCurrentTime = () => time();
        this.getPlayerState = () => playerState;
        const startPlaying = () => {
            if (started === null) started = now();
            emit(1);
            render();
        };
        const autoplayBlocked = () => {
            policy.blockedEvents = (policy.blockedEvents || 0) + 1;
            opts.events && opts.events.onAutoplayBlocked && opts.events.onAutoplayBlocked({ target: this });
        };
        if (policy) {
            policy.players = policy.players || [];
            // Stored callbacks let focused tests deliver a provider event after
            // a source change or room teardown without changing application state.
            policy.players.push({ emitAutoplayBlocked: autoplayBlocked, finishPlayback: startPlaying });
        }
        this.playVideo = () => {
            if (policy) {
                policy.playCalls = (policy.playCalls || 0) + 1;
                if (policy.blocked) {
                    setTimeout(autoplayBlocked, 0);
                    return;
                }
                if (policy.deferPlaying) return;
            }
            startPlaying();
        };
        this.pauseVideo = () => {
            if (started !== null) {
                base = time();
                started = null;
            }
            emit(2);
            render();
        };
        this.seekTo = (s) => {
            base = s;
            if (started !== null) started = now();
            render();
        };
        const swapVideo = (id, startSeconds, autoplay) => {
            const wasPlaying = playerState === 1;
            videoId = id;
            base = startSeconds || 0;
            started = null;
            emit(5);
            render();
            setTimeout(() => {
                if (autoplay || wasPlaying) {
                    if (policy) this.playVideo();
                    else { started = now(); emit(1); }
                } else {
                    emit(2);
                }
                render();
            }, 0);
        };
        this.cueVideoById = (id) => swapVideo(id, 0, false);
        this.loadVideoById = (arg) => {
            const id = typeof arg === 'string' ? arg : arg.videoId;
            const start = typeof arg === 'object' && arg ? arg.startSeconds : 0;
            swapVideo(id, start, true);
        };
        this.stopVideo = () => { base = 0; started = null; emit(2); render(); };
        render();
        window.__ytLog.push(this);
        setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady({ target: this }), 10);
    }
};
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
