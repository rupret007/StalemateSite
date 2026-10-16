import './turdanoid-storage-core.js';

const api = globalThis.TurdanoidStorage;

export const PREFS_KEY = api.PREFS_KEY;
export const PREFS_VERSION = api.PREFS_VERSION;
export const LEGACY_KEYS = api.LEGACY_KEYS;
export const DEFAULT_PREFS = api.DEFAULT_PREFS;
export const SCORE_MAX = api.SCORE_MAX;
export const probeStorage = api.probeStorage;
export const createSafeStorage = api.createSafeStorage;
export const parseScore = api.parseScore;
export const mergeScores = api.mergeScores;
export const sanitizePrefs = api.sanitizePrefs;
export const parsePrefsBlob = api.parsePrefsBlob;
export const loadPrefs = api.loadPrefs;
export const savePrefs = api.savePrefs;
