import './turdrummy-ai-core.js';

const api = globalThis.TurdRummyAI;

export const SAFETY_WEIGHTS = api.SAFETY_WEIGHTS;
export const computeDiscardSafety = api.computeDiscardSafety;
export const DIFFICULTY_KEY = api.DIFFICULTY_KEY;
export const DEFAULT_LEVEL = api.DEFAULT_LEVEL;
export const AI_PROFILES = api.AI_PROFILES;
export const FEED_WEIGHTS = api.FEED_WEIGHTS;
export const profileFor = api.profileFor;
export const activeHumanTakes = api.activeHumanTakes;
export const computeFeedRisk = api.computeFeedRisk;
export const computeKnockThreshold = api.computeKnockThreshold;
export const applyScoreNoise = api.applyScoreNoise;
export const loadDifficulty = api.loadDifficulty;
export const saveDifficulty = api.saveDifficulty;
