// Stand-in for https://www.youtube.com/iframe_api so sync tests are deterministic and offline.
window.__ytLog = [];
window.YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: function FakePlayer(el, opts) {
        const node = typeof el === 'string' ? document.getElementById(el) : el;
        const box = document.createElement('div');
        box.id = node.id;
        box.dataset.fakeYt = '';
        box.style.background = '#333';
        node.replaceWith(box);
        let videoId = opts.videoId;
        let base = 0;
        let started = null;
        let playerState = 2;
        const now = () => performance.now() / 1000;
        const time = () => (started === null ? base : base + (now() - started));
        const syncState = () => { playerState = started === null ? 2 : 1; };
        const emit = (state) => {
            playerState = state;
            opts.events && opts.events.onStateChange && opts.events.onStateChange({ data: state });
        };
        const render = () => {
            syncState();
            box.dataset.videoId = videoId;
            box.dataset.state = playerState === 1 ? 'playing' : 'paused';
            box.textContent = `YT ${videoId}`;
        };
        this.getCurrentTime = () => time();
        this.getPlayerState = () => playerState;
        this.playVideo = () => {
            if (started === null) started = now();
            emit(1);
            render();
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
                    started = now();
                    emit(1);
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
