/**
 * Shared Stalemate band playlist for every suite page.
 * Advances on track end (no loop), persists index across games, honours mute + game gates.
 */
export const MUTE_STORAGE_KEY = 'turdsuite_muted';
export const MUSIC_PREF_KEY = 'stalemate.music';
export const TRACK_INDEX_KEY = 'turdsuite_music_track_v1';

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
  { path: 'stalemate/andrea.m4a', title: 'Andrea' },
  { path: 'stalemate/only-been-18.m4a', title: STALEMATE_TRACK_ONLY_BEEN_18_TITLE },
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
 * @param {(state: { paused: boolean, title: string }) => void} [opts.onStateChange]
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

  function blocked() {
    return !!isSuiteMuted() || !!isGameBlocked() || !!isDocumentHidden();
  }

  function currentTrack() {
    return playlist[index] || playlist[0];
  }

  function publishState() {
    const track = currentTrack();
    onStateChange({
      paused: blocked() || audio.paused,
      title: track ? track.title : ''
    });
  }

  function loadIndex(nextIndex) {
    index = nextIndex;
    try {
      if (storage) storage.setItem(TRACK_INDEX_KEY, String(index));
    } catch {
      /* ignore */
    }
    const track = currentTrack();
    if (track) {
      audio.src = resolveSrc(track.path);
    }
  }

  function onEnded() {
    const next = advanceTrackIndex(index, playlist.length);
    loadIndex(next);
    if (armed && !blocked()) {
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(publishState, publishState);
      } else {
        publishState();
      }
    } else {
      publishState();
    }
  }

  audio.addEventListener('play', publishState);
  audio.addEventListener('pause', publishState);
  audio.addEventListener('ended', onEnded);

  loadIndex(index);

  function sync() {
    if (!armed || blocked()) {
      audio.pause();
      publishState();
      return;
    }
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(publishState, publishState);
    } else {
      publishState();
    }
  }

  return {
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
      return armed && !blocked() && !audio.paused;
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
      audio.pause();
      publishState();
    },
    /** Test hook: simulate natural track end without waiting for decode. */
    advanceForTest() {
      onEnded();
    }
  };
}
