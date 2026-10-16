/* Safe localStorage wrapper — private mode / quota fall back to memory.
   Versioned prefs blob (settings + high scores) migrates the older single keys. */
(function attachTurdanoidStorage(root) {
  'use strict';

  const PREFS_KEY = 'turdanoid_prefs_v1';
  const PREFS_VERSION = 1;
  const LEGACY_KEYS = {
    best: 'turdanoid_v2_best',
    sound: 'turdanoid_v2_sound',
    ambient: 'turdanoid_v3_ambient',
    haptic: 'turdanoid_v3_haptic',
    bossBest: 'turdanoid_boss_best_v1'
  };
  const DEFAULT_PREFS = {
    v: PREFS_VERSION,
    best: 0,
    soundOn: true,
    ambientOn: false,
    hapticOn: true,
    bossBest: 0
  };
  const SCORE_MAX = 1e9;
  const KNOWN_PREF_KEYS = {
    v: true,
    best: true,
    soundOn: true,
    ambientOn: true,
    hapticOn: true,
    bossBest: true
  };
  const WELL_FORMED_INT = /^(?:0|[1-9]\d*)$/;

  function probeStorage(owner) {
    try {
      const storage = owner && owner.localStorage;
      if (!storage) {
        return null;
      }
      void storage.length;
      return storage;
    } catch {
      return null;
    }
  }

  function createSafeStorage(primary) {
    const memory = Object.create(null);

    function getItem(key) {
      const name = String(key);
      if (Object.prototype.hasOwnProperty.call(memory, name)) {
        return memory[name];
      }
      if (!primary) {
        return null;
      }
      try {
        const value = primary.getItem(name);
        if (value === null || value === undefined) {
          return null;
        }
        return String(value);
      } catch {
        return null;
      }
    }

    function setItem(key, value) {
      const name = String(key);
      const str = String(value);
      if (primary) {
        try {
          primary.setItem(name, str);
          delete memory[name];
          return;
        } catch {
          /* quota / private mode — keep the write in memory */
        }
      }
      memory[name] = str;
    }

    function removeItem(key) {
      const name = String(key);
      delete memory[name];
      if (!primary) {
        return;
      }
      try {
        primary.removeItem(name);
      } catch {
        /* ignore */
      }
    }

    return {
      getItem,
      setItem,
      removeItem
    };
  }

  function readRaw(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') {
      return null;
    }
    try {
      const value = storage.getItem(key);
      if (value === null || value === undefined) {
        return null;
      }
      return String(value);
    } catch {
      return null;
    }
  }

  function writeRaw(storage, key, value) {
    if (!storage || typeof storage.setItem !== 'function') {
      return;
    }
    try {
      storage.setItem(key, String(value));
    } catch {
      /* quota / private mode — caller already wrapped persist when possible */
    }
  }

  /* Single score validator for every prefs read/write path.
     Accept only a finite integer number, or a plain decimal digit string
     (legacy localStorage). Never String()-coerce arrays/objects/bools. */
  function parseScore(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > SCORE_MAX) {
        return null;
      }
      return value;
    }
    if (typeof value === 'string' && WELL_FORMED_INT.test(value)) {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > SCORE_MAX) {
        return null;
      }
      return n;
    }
    return null;
  }

  function mergeScores() {
    let highest = null;
    for (let i = 0; i < arguments.length; i++) {
      const n = parseScore(arguments[i]);
      if (n !== null && (highest === null || n > highest)) {
        highest = n;
      }
    }
    return highest === null ? 0 : highest;
  }

  function isCanonicalScore(value) {
    return typeof value === 'number' && parseScore(value) === value;
  }

  function readPrefsVersion(value) {
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value < 1) {
        return 0;
      }
      return value;
    }
    if (typeof value === 'string' && WELL_FORMED_INT.test(value)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) {
        return 0;
      }
      return n;
    }
    return 0;
  }

  function sanitizeBool(value, fallback) {
    if (value === true || value === '1' || value === 'true') {
      return true;
    }
    if (value === false || value === '0' || value === 'false') {
      return false;
    }
    return fallback;
  }

  function sanitizePrefs(raw, fallback) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const fb = fallback && typeof fallback === 'object' ? fallback : DEFAULT_PREFS;
    return {
      v: PREFS_VERSION,
      best: mergeScores(src.best, fb.best, DEFAULT_PREFS.best),
      soundOn: sanitizeBool(src.soundOn, fb.soundOn !== false),
      ambientOn: sanitizeBool(src.ambientOn, !!fb.ambientOn),
      hapticOn: sanitizeBool(src.hapticOn, fb.hapticOn !== false),
      bossBest: mergeScores(src.bossBest, fb.bossBest, DEFAULT_PREFS.bossBest)
    };
  }

  function parsePrefsBlob(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    try {
      const parsed = JSON.parse(String(raw));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function readLegacyPrefs(storage) {
    return {
      v: PREFS_VERSION,
      best: mergeScores(readRaw(storage, LEGACY_KEYS.best)),
      soundOn: readRaw(storage, LEGACY_KEYS.sound) !== '0',
      ambientOn: readRaw(storage, LEGACY_KEYS.ambient) === '1',
      hapticOn: readRaw(storage, LEGACY_KEYS.haptic) !== '0',
      bossBest: mergeScores(readRaw(storage, LEGACY_KEYS.bossBest))
    };
  }

  function hasLegacyKeys(storage) {
    return Object.values(LEGACY_KEYS).some((key) => readRaw(storage, key) !== null);
  }

  function aliasesInSync(storage, prefs) {
    return (
      readRaw(storage, LEGACY_KEYS.best) === String(prefs.best) &&
      readRaw(storage, LEGACY_KEYS.sound) === (prefs.soundOn ? '1' : '0') &&
      readRaw(storage, LEGACY_KEYS.ambient) === (prefs.ambientOn ? '1' : '0') &&
      readRaw(storage, LEGACY_KEYS.haptic) === (prefs.hapticOn ? '1' : '0') &&
      readRaw(storage, LEGACY_KEYS.bossBest) === String(prefs.bossBest)
    );
  }

  function prefsEqual(a, b) {
    return (
      a.v === b.v &&
      a.best === b.best &&
      a.soundOn === b.soundOn &&
      a.ambientOn === b.ambientOn &&
      a.hapticOn === b.hapticOn &&
      a.bossBest === b.bossBest
    );
  }

  function knownPrefsAreCanonical(blob) {
    return (
      !!blob &&
      typeof blob === 'object' &&
      !Array.isArray(blob) &&
      isCanonicalScore(blob.v) &&
      blob.v >= 1 &&
      isCanonicalScore(blob.best) &&
      isCanonicalScore(blob.bossBest) &&
      (blob.soundOn === true || blob.soundOn === false) &&
      (blob.ambientOn === true || blob.ambientOn === false) &&
      (blob.hapticOn === true || blob.hapticOn === false)
    );
  }

  function copyUnknownFields(blob) {
    const extras = {};
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
      return extras;
    }
    Object.keys(blob).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PREF_KEYS, key)) {
        extras[key] = blob[key];
      }
    });
    return extras;
  }

  function writePrefs(storage, prefs, existingBlob) {
    const next = sanitizePrefs(prefs);
    next.best = mergeScores(
      next.best,
      existingBlob ? existingBlob.best : null,
      readRaw(storage, LEGACY_KEYS.best)
    );
    next.bossBest = mergeScores(
      next.bossBest,
      existingBlob ? existingBlob.bossBest : null,
      readRaw(storage, LEGACY_KEYS.bossBest)
    );
    const existingVersion = existingBlob ? readPrefsVersion(existingBlob.v) : 0;
    const stored = Object.assign({}, copyUnknownFields(existingBlob), next);
    if (existingVersion > PREFS_VERSION) {
      stored.v = existingVersion;
    }
    writeRaw(storage, PREFS_KEY, JSON.stringify(stored));
    writeRaw(storage, LEGACY_KEYS.best, String(next.best));
    writeRaw(storage, LEGACY_KEYS.sound, next.soundOn ? '1' : '0');
    writeRaw(storage, LEGACY_KEYS.ambient, next.ambientOn ? '1' : '0');
    writeRaw(storage, LEGACY_KEYS.haptic, next.hapticOn ? '1' : '0');
    writeRaw(storage, LEGACY_KEYS.bossBest, String(next.bossBest));
    return next;
  }

  function loadPrefs(storage) {
    const raw = readRaw(storage, PREFS_KEY);
    const blob = parsePrefsBlob(raw);
    const legacy = readLegacyPrefs(storage);
    if (blob) {
      const blobVersion = readPrefsVersion(blob.v);
      const merged = sanitizePrefs({ ...legacy, ...blob }, legacy);
      const rawInvalid = !knownPrefsAreCanonical(blob);
      const mergedDiffers = !prefsEqual(sanitizePrefs(blob, DEFAULT_PREFS), merged);
      const repaired = rawInvalid || mergedDiffers;
      const oldVersion = blobVersion > 0 && blobVersion < PREFS_VERSION;
      const staleAliases = !aliasesInSync(storage, merged);
      if (repaired || oldVersion || staleAliases) {
        return writePrefs(storage, merged, blob);
      }
      return merged;
    }
    if (hasLegacyKeys(storage)) {
      return writePrefs(storage, legacy);
    }
    if (raw !== null) {
      return writePrefs(storage, DEFAULT_PREFS);
    }
    return { ...DEFAULT_PREFS };
  }

  function savePrefs(storage, patch) {
    const current = loadPrefs(storage);
    const src = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const existingBlob = parsePrefsBlob(readRaw(storage, PREFS_KEY));
    return writePrefs(storage, { ...current, ...src }, existingBlob);
  }

  root.TurdanoidStorage = {
    PREFS_KEY,
    PREFS_VERSION,
    LEGACY_KEYS,
    DEFAULT_PREFS,
    probeStorage,
    createSafeStorage,
    SCORE_MAX,
    parseScore,
    mergeScores,
    sanitizePrefs,
    parsePrefsBlob,
    loadPrefs,
    savePrefs
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
