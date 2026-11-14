const muteKey = 'gn:sound-muted';
let context, player, muted = false;
try { muted = (localStorage.getItem(muteKey) ?? localStorage.getItem('turdsuite_muted')) === '1'; }
catch { /* Storage is optional. */ }

let soundRenderer;
function loadSoundRenderer() {
    soundRenderer ??= import('/play/assets/suite-sound.js').then(({ createStudioAudio }) => {
        player = createStudioAudio({
            getContext: () => context, isMuted: () => muted, canPlay: () => !document.hidden, getVolume: () => .35
        });
    }).catch(() => { soundRenderer = undefined; });
    return soundRenderer;
}

export function unlockGameNightAudio(event) {
    if (!event?.isTrusted || muted || document.hidden) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
        // Web Audio uses the browser's normal routing. The game's effects do
        // not override the document audio category shared with the room call.
        context ??= new Audio();
        if (context.state !== 'running') void context.resume().catch(() => {});
    } catch { /* Audio is optional for play. */ }
}

export function mountGameNightSound(button, gameSurface) {
    const label = button.querySelector('span');
    const draw = () => {
        button.setAttribute('aria-pressed', String(!muted));
        label.textContent = muted ? 'Off' : 'On';
    };
    const toggle = event => {
        muted = !muted;
        try { localStorage.setItem(muteKey, muted ? '1' : '0'); } catch { /* In-memory mute still applies. */ }
        draw();
        if (muted) player?.stop();
        else unlockGameNightAudio(event);
    };
    button.addEventListener('click', toggle);
    button.hidden = false;
    const activate = event => {
        if (event.target.closest('details[class^=arcade-]')) unlockGameNightAudio(event);
    };
    // The invitation can navigate to a new document, where browsers can
    // require another trusted gesture before resuming the new audio context.
    gameSurface.addEventListener('click', activate, true);
    gameSurface.addEventListener('keydown', activate, true);
    window.addEventListener('pagehide', () => player?.stop());
    document.addEventListener('visibilitychange', () => player?.sync());
    draw();
}

export function gameNightCue(event) {
    if (context?.state !== 'running' || muted || document.hidden) return;
    void loadSoundRenderer().then(() => {
        try { player?.playEvent(event); } catch { /* Sound cannot interrupt a match. */ }
    });
}
