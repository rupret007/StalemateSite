import './turdanoid-levels-core.js';

const api = globalThis.TurdanoidLevels;

export const BASE_PATTERN_NAMES = api.BASE_PATTERN_NAMES;
export const EXTRA_PATTERN_NAMES = api.EXTRA_PATTERN_NAMES;
export const CELL_TYPES = api.CELL_TYPES;
export const CAMPAIGN_COLS = api.CAMPAIGN_COLS;
export const allPatternNames = api.allPatternNames;
export const shouldPlaceBrick = api.shouldPlaceBrick;
export const computeBallSpeed = api.computeBallSpeed;
export const computeDropChance = api.computeDropChance;
export const definitionForLevel = api.definitionForLevel;
export const campaignLevelCount = api.campaignLevelCount;
export const buildCampaignCells = api.buildCampaignCells;
export const metricsForLevel = api.metricsForLevel;
export const metricsForDefinition = api.metricsForDefinition;
export const campaignMetrics = api.campaignMetrics;
export const isBreakable = api.isBreakable;
export const remainingBreakable = api.remainingBreakable;
export const applyDamage = api.applyDamage;
export const isClearable = api.isClearable;
export const hazardIntervalFrames = api.hazardIntervalFrames;
export const collectDripSpawns = api.collectDripSpawns;
export const hazardHitsPaddle = api.hazardHitsPaddle;
