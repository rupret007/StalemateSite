// Stand-in for https://www.youtube.com/iframe_api so sync tests are deterministic and offline.
window.__ytLog = [];
window.YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2 },
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
        const now = () => performance.now() / 1000;
        const time = () => (started === null ? base : base + (now() - started));
        const emit = (state) => opts.events && opts.events.onStateChange && opts.events.onStateChange({ data: state });
        const render = () => { box.dataset.videoId = videoId; box.dataset.state = started === null ? 'paused' : 'playing'; box.textContent = `YT ${videoId}`; };
        this.getCurrentTime = () => time();
        this.getPlayerState = () => (started === null ? 2 : 1);
        this.playVideo = () => { if (started === null) { started = now(); render(); emit(1); } };
        this.pauseVideo = () => { if (started !== null) { base = time(); started = null; render(); emit(2); } };
        this.seekTo = (s) => { base = s; if (started !== null) started = now(); };
        this.cueVideoById = (id) => { videoId = id; base = 0; started = null; render(); };
        this.stopVideo = () => { base = 0; started = null; render(); };
        render();
        window.__ytLog.push(this);
        setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady({ target: this }), 10);
    }
};
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
