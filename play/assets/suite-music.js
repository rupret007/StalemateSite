/**
 * Shared Stalemate band playlist for every suite page.
 * Advances on track end (no loop), persists index across games, honours mute + game gates.
 */
export const MUTE_STORAGE_KEY = 'turdsuite_muted';
export const MUSIC_PREF_KEY = 'stalemate.music';
export const TRACK_INDEX_KEY = 'turdsuite_music_track_v1';
export const PLAYBACK_KEY = 'turdsuite_music_playback_v1';

const LEGACY_MUSIC_OFF = [
  ['turdtrisMusic_v1', (v) => v === '0']
];

/**
 * @param {Storage|null|undefined} storage
 */
export function migrateMusicPref(storage) {
  if (!storage) return;
  try {
    if (storage.getItem(MUSIC_PREF_KEY) !== null) return;
    for (const [key, isOff] of LEGACY_MUSIC_OFF) {
      const raw = storage.getItem(key);
      if (raw !== null && isOff(raw)) {
        storage.setItem(MUSIC_PREF_KEY, 'off');
        return;
      }
    }
  } catch {
    /* ignore */
  }
}

/** @param {Storage|null|undefined} storage */
export function readMusicEnabled(storage) {
  migrateMusicPref(storage);
  try {
    const v = storage && storage.getItem(MUSIC_PREF_KEY);
    if (v === 'off') return false;
    if (v === 'on') return true;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * @param {Storage|null|undefined} storage
 * @param {boolean} on
 */
export function writeMusicEnabled(storage, on) {
  try {
    if (storage) storage.setItem(MUSIC_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

/** Jeff / Stalemate — exact on-site title for only-been-18.m4a (curly apostrophe). */
export const STALEMATE_TRACK_ONLY_BEEN_18_TITLE = 'It\u2019s Only Been 18';

export const STALEMATE_PLAYLIST = [
  { path: 'stalemate/manic.m4a', title: 'Manic' },
  { path: 'stalemate/andrea.m4a', title: 'Andrea', listenUrl: 'https://music.apple.com/us/album/andrea/1718463871?i=1718463872' },
  { path: 'stalemate/only-been-18.m4a', title: STALEMATE_TRACK_ONLY_BEEN_18_TITLE, listenUrl: 'https://music.apple.com/us/album/its-been-only-18/1718464113?i=1718464114' },
  { path: 'stalemate/wham-bam.m4a', title: 'Wham Bam' },
  { path: 'stalemate/planet-of-the-flakes.m4a', title: 'Planet of the Flakes' }
];

/** @param {number} current @param {number} length */
export function advanceTrackIndex(current, length) {
  const len = Math.max(0, Math.floor(length));
  if (len <= 0) return 0;
  const cur = Math.max(0, Math.floor(current));
  return (cur + 1) % len;
}

/** @param {Storage|null|undefined} storage @param {number} length */
export function readTrackIndex(storage, length) {
  const len = Math.max(0, Math.floor(length));
  if (len <= 0) return 0;
  try {
    const raw = storage && storage.getItem(TRACK_INDEX_KEY);
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n % len;
  } catch {
    return 0;
  }
}

/**
 * @param {object} opts
 * @param {typeof STALEMATE_PLAYLIST} [opts.playlist]
 * @param {() => boolean} opts.isSuiteMuted
 * @param {() => boolean} [opts.isGameBlocked]
 * @param {() => boolean} [opts.isDocumentHidden]
 * @param {(path: string) => string} opts.resolveSrc
 * @param {Storage|null} [opts.storage]
 * @param {typeof Audio} [opts.AudioCtor]
 * @param {(state: { paused: boolean, title: string, listenUrl: string, index: number, status: string, canRetry: boolean }) => void} [opts.onStateChange]
 */
export function createSuiteMusic(opts) {
  const playlist = opts.playlist || STALEMATE_PLAYLIST;
  const isSuiteMuted = opts.isSuiteMuted;
  const isGameBlocked = opts.isGameBlocked || (() => false);
  const isDocumentHidden = opts.isDocumentHidden || (() => false);
  const resolveSrc = opts.resolveSrc;
  const storage = opts.storage || null;
  const AudioCtor = opts.AudioCtor || globalThis.Audio;
  const onStateChange = opts.onStateChange || (() => {});

  const audio = new AudioCtor();
  audio.loop = false;
  audio.preload = 'none';
  audio.volume = 0.45;
  if (audio.setAttribute) audio.setAttribute('playsinline', '');

  let armed = false;
  let index = readTrackIndex(storage, playlist.length);
  let pendingResume = 0;
  let lastSavedSecond = -1;
  let phase = 'paused';
  let failure = '';
  let generation = 0;
  let pendingPlay = 0;
  try {
    const saved = JSON.parse(storage?.getItem(PLAYBACK_KEY) || 'null');
    if (saved?.v === 1 && saved.track === playlist[index]?.path && Number.isFinite(saved.seconds)
        && saved.seconds >= 0 && saved.seconds < 86400) pendingResume = saved.seconds;
  } catch { /* Storage is optional; malformed saves start at the track beginning. */ }

  function savePosition() {
    if (pendingResume > 0) return; // An unarmed/new page must not erase its pending seek.
    const seconds = Number(audio.currentTime);
    if (!Number.isFinite(seconds) || seconds < 0) return;
    try { storage?.setItem(PLAYBACK_KEY, JSON.stringify({ v: 1, track: playlist[index]?.path, seconds })); }
    catch { /* Music keeps working when storage is denied or full. */ }
    lastSavedSecond = Math.floor(seconds);
  }

  function restorePosition() {
    if (!pendingResume || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const seconds = pendingResume < audio.duration - 1 ? pendingResume : 0;
    try { audio.currentTime = seconds; pendingResume = 0; }
    catch { return; } // Some media engines cannot seek until metadata/data is ready.
    savePosition();
  }

  function blocked() {
    return !!isSuiteMuted() || !!isGameBlocked() || !!isDocumentHidden();
  }

  function currentTrack() {
    return playlist[index] || playlist[0];
  }

  function publishState() {
    const track = currentTrack();
    const status = !armed || blocked() ? 'paused' : failure || phase;
    onStateChange({
      paused: status !== 'playing',
      status,
      canRetry: !!failure && armed && !blocked(),
      index,
      title: track ? track.title : '',
      listenUrl: track ? track.listenUrl || '' : ''
    });
  }

  function loadIndex(nextIndex, resume = 0) {
    generation += 1;
    pendingPlay = 0;
    failure = '';
    phase = 'paused';
    pendingResume = resume;
    index = nextIndex;
    lastSavedSecond = -1;
    try {
      if (storage) storage.setItem(TRACK_INDEX_KEY, String(index));
    } catch {
      /* ignore */
    }
    const track = currentTrack();
    if (track) {
      audio.src = resolveSrc(track.path);
    }
    if (!resume) savePosition();
  }

  function failed(error) {
    failure = error?.name === 'NotAllowedError' ? 'blocked' : 'error';
    phase = 'paused';
    generation += 1;
    pendingPlay = 0;
    audio.pause();
    publishState();
  }

  function play() {
    // Turning music on can sync both the preference and the gesture. Keep the
    // original request (and its playing event) instead of resetting it twice.
    if (pendingPlay || (!audio.paused && phase === 'playing')) {
      publishState();
      return;
    }
    const request = ++generation;
    pendingPlay = request;
    phase = 'loading';
    publishState();
    try {
      Promise.resolve(audio.play()).then(() => {
        if (request !== generation) return;
        pendingPlay = 0;
        if (blocked() || audio.paused || failure) return;
        phase = 'playing';
        publishState();
      }, error => {
        if (request !== generation) return;
        pendingPlay = 0;
        if (!blocked()) failed(error);
      });
    } catch (error) {
      if (request === generation && !blocked()) failed(error);
    }
  }

  function onEnded() {
    loadIndex(advanceTrackIndex(index, playlist.length));
    sync();
  }

  audio.addEventListener('playing', () => {
    if (failure || blocked() || !armed) return;
    phase = 'playing'; publishState();
  });
  for (const event of ['waiting', 'stalled']) audio.addEventListener(event, () => {
    if (failure || blocked() || !armed) return;
    // A stalled network fetch does not stop playback of already buffered data.
    if (event === 'stalled' && Number(audio.readyState) >= 3 && !audio.paused) return;
    phase = 'loading'; publishState();
  });
  audio.addEventListener('error', () => { if (audio.error) failed(audio.error); });
  audio.addEventListener('pause', () => { phase = 'paused'; savePosition(); publishState(); });
  audio.addEventListener('loadedmetadata', restorePosition);
  audio.addEventListener('canplay', restorePosition);
  audio.addEventListener('timeupdate', () => {
    restorePosition();
    if (Math.abs(Math.floor(audio.currentTime) - lastSavedSecond) >= 5) savePosition();
  });
  audio.addEventListener('ended', onEnded);

  loadIndex(index, pendingResume);

  function sync() {
    if (!armed || blocked()) {
      generation += 1;
      pendingPlay = 0;
      audio.pause();
      publishState();
      return;
    }
    // Game/visibility changes must not create an unbounded retry loop.
    if (failure) {
      publishState();
      return;
    }
    play();
  }

  return {
    get tracks() { return playlist.map((track, trackIndex) => ({ index: trackIndex, title: track.title })); },
    savePosition,
    nextTrack() { this.playTrackAt(advanceTrackIndex(index, playlist.length)); },
    retryTrack() {
      if (!failure || !armed || blocked()) return;
      const resume = pendingResume || Number(audio.currentTime) || 0;
      loadIndex(index, resume);
      if (typeof audio.load === 'function') audio.load();
      sync();
    },
    get armed() {
      return armed;
    },
    get trackIndex() {
      return index;
    },
    get trackTitle() {
      return currentTrack()?.title || '';
    },
    get audioElement() {
      return audio;
    },
    isPlaying() {
      return armed && !blocked() && !audio.paused && !failure;
    },
    armFromGesture() {
      if (armed) {
        sync();
        return;
      }
      armed = true;
      sync();
    },
    playTrackAt(nextIndex) {
      const len = playlist.length;
      if (len <= 0) return;
      const idx = Math.max(0, Math.floor(nextIndex)) % len;
      loadIndex(idx);
      armed = true;
      sync();
    },
    sync,
    pause() {
      generation += 1;
      pendingPlay = 0;
      audio.pause();
      publishState();
    },
    /** Test hook: simulate natural track end without waiting for decode. */
    advanceForTest() {
      onEnded();
    }
  };
}
