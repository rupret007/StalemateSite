/**
 * Compact centered phone hand (7 + 6 rows for 13 cards).
 * Index corners stay readable: 18×28px regions must not intersect a higher-z card body.
 */
export const PHONE_INDEX_WIDTH = 18;
export const PHONE_INDEX_HEIGHT = 28;
export const PHONE_SELECTED_LIFT = 8;

const CARD_ASPECT = 1.42;
const MAX_HAND_HEIGHT = 160;
const ROW_GAP = 4;
/** Minimum clear space between stacked row card bodies (not index corners). */
export const PHONE_ROW_BODY_GAP = 6;
const ARC_HEIGHT = 4;

function indexRect(pos, layout, lift = 0) {
  return {
    left: pos.x,
    top: pos.y - lift,
    right: pos.x + PHONE_INDEX_WIDTH,
    bottom: pos.y - lift + PHONE_INDEX_HEIGHT
  };
}

function cardRect(pos, layout, lift = 0) {
  return {
    left: pos.x,
    top: pos.y - lift,
    right: pos.x + layout.cardWidth,
    bottom: pos.y - lift + layout.cardHeight
  };
}

function rectsOverlap(a, b) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
}

/** True when no higher-z card body covers another card's index region (optional selected lift). */
/** Same rule as layout math, using measured card boxes (e.g. getBoundingClientRect). */
export function phoneHandDomIndexRegionsClear(cardRects, selectedIndex = null) {
  if (!Array.isArray(cardRects) || !cardRects.length) {return true;}
  const liftFor = (index) => (selectedIndex === index ? PHONE_SELECTED_LIFT : 0);
  for (let i = 0; i < cardRects.length; i++) {
    const card = cardRects[i];
    const idx = {
      left: card.left,
      top: card.top - liftFor(i),
      right: card.left + PHONE_INDEX_WIDTH,
      bottom: card.top - liftFor(i) + PHONE_INDEX_HEIGHT
    };
    for (let j = 0; j < cardRects.length; j++) {
      if (i === j) {continue;}
      const other = cardRects[j];
      const zI = Number(card.z) || 0;
      const zJ = Number(other.z) || 0;
      if (zJ <= zI) {continue;}
      const body = {
        left: other.left,
        top: other.top - liftFor(j),
        right: other.left + other.width,
        bottom: other.top - liftFor(j) + other.height
      };
      if (rectsOverlap(idx, body)) {return false;}
    }
  }
  return true;
}

export function phoneHandIndexRegionsClear(layout, selectedIndex = null) {
  if (!layout?.positions?.length) {return true;}
  const liftFor = (index) => (selectedIndex === index ? PHONE_SELECTED_LIFT : 0);
  for (let i = 0; i < layout.positions.length; i++) {
    const idx = indexRect(layout.positions[i], layout, liftFor(i));
    for (let j = 0; j < layout.positions.length; j++) {
      if (i === j) {continue;}
      if (layout.positions[j].z <= layout.positions[i].z) {continue;}
      const body = cardRect(layout.positions[j], layout, liftFor(j));
      if (rectsOverlap(idx, body)) {return false;}
    }
  }
  return true;
}

export function layoutPhoneHand({ count = 0, width = 320 } = {}) {
  const cardCount = Number.isFinite(count) ? Math.min(13, Math.max(0, Math.floor(count))) : 0;
  const availableWidth = Number.isFinite(width) ? Math.max(0, width) : 320;
  if (cardCount === 0) {
    return {
      cardWidth: 0,
      cardHeight: 0,
      height: 0,
      selectedLift: PHONE_SELECTED_LIFT,
      rowStride: 0,
      rows: 0,
      positions: []
    };
  }

  let cardHeightCap = Math.floor((MAX_HAND_HEIGHT - PHONE_SELECTED_LIFT - ROW_GAP) / 2);

  for (let attempt = 0; attempt < 12; attempt++) {
    let cardWidth = Math.min(availableWidth, Math.max(48, Math.min(58, availableWidth / 6.5)));
    let cardHeight = Math.min(Math.round(cardWidth * CARD_ASPECT), cardHeightCap);
    cardWidth = Math.round(cardHeight / CARD_ASPECT);
    const indexPitchMin = Math.max(PHONE_INDEX_WIDTH, cardWidth - PHONE_INDEX_WIDTH + 1);
    const singleRowCapacity = Math.max(
      1,
      Math.floor((availableWidth - cardWidth) / indexPitchMin) + 1
    );
    const rows = cardCount > singleRowCapacity ? 2 : 1;
    const rowGap = rows === 2 ? Math.max(ROW_GAP, PHONE_ROW_BODY_GAP) : ROW_GAP;
    const rearCount = rows === 2 ? Math.ceil(cardCount / 2) : cardCount;
    if (rows === 2) {
      const maxTwoRowCardHeight = Math.floor(
        (MAX_HAND_HEIGHT - PHONE_SELECTED_LIFT - rowGap - ARC_HEIGHT) / 2
      );
      if (cardHeight > maxTwoRowCardHeight) {
        cardHeight = maxTwoRowCardHeight;
        cardWidth = Math.round(cardHeight / CARD_ASPECT);
      }
    } else if (cardHeight > Math.floor((MAX_HAND_HEIGHT - PHONE_SELECTED_LIFT))) {
      cardHeight = Math.floor((MAX_HAND_HEIGHT - PHONE_SELECTED_LIFT));
      cardWidth = Math.round(cardHeight / CARD_ASPECT);
    }

    const minRowStride = rows === 2
      ? PHONE_SELECTED_LIFT + ARC_HEIGHT + cardHeight + PHONE_ROW_BODY_GAP - PHONE_SELECTED_LIFT
      : 0;
    const rowStride = rows === 2
      ? Math.max(cardHeight + rowGap, minRowStride)
      : cardHeight + rowGap;
    const pitchFor = (rowCount) => {
      if (rowCount <= 1) {return 0;}
      const maxPitch = (availableWidth - cardWidth) / (rowCount - 1);
      const minPitch = Math.max(PHONE_INDEX_WIDTH, cardWidth - PHONE_INDEX_WIDTH + 1);
      return Math.max(PHONE_INDEX_WIDTH, Math.min(maxPitch, minPitch));
    };

    const rearPitch = pitchFor(rearCount);
    const frontCount = rows === 2 ? cardCount - rearCount : 0;
    const frontPitch = rows === 2 ? pitchFor(frontCount) : 0;
    const frontOffset = rows === 2 ? Math.max(0, (rearPitch - frontPitch) / 2) : 0;

    const positions = Array.from({ length: cardCount }, (_, index) => {
      const row = rows === 2 && index >= rearCount ? 1 : 0;
      const rowIndex = row === 0 ? index : index - rearCount;
      const rowCount = row === 0 ? rearCount : frontCount;
      const pitch = row === 0 ? rearPitch : frontPitch;
      const rowWidth = cardWidth + (rowCount - 1) * pitch;
      const rowStart = (availableWidth - rowWidth) / 2 + (row === 1 ? frontOffset : 0);
      const midpoint = (rowCount - 1) / 2;
      const arc = rowCount > 1 ? Math.pow((rowIndex - midpoint) / (midpoint || 1), 2) * ARC_HEIGHT : 0;
      return {
        x: rowStart + rowIndex * pitch,
        y: PHONE_SELECTED_LIFT + row * rowStride + arc,
        z: index + 1,
        row
      };
    });

    const height = PHONE_SELECTED_LIFT + (rows - 1) * rowStride + ARC_HEIGHT + cardHeight;
    let rowGapOk = true;
    if (rows === 2) {
      const rearBottom = Math.max(
        ...positions.filter((card) => card.row === 0).map((card) => card.y + cardHeight)
      );
      const frontTop = Math.min(...positions.filter((card) => card.row === 1).map((card) => card.y));
      rowGapOk = frontTop - rearBottom >= PHONE_ROW_BODY_GAP - 0.000001;
    }

    if (height <= MAX_HAND_HEIGHT && rowGapOk && cardHeight >= 44) {
      return {
        cardWidth,
        cardHeight,
        height,
        selectedLift: PHONE_SELECTED_LIFT,
        rowStride,
        rows,
        positions
      };
    }

    const shrinkTarget = rows === 2
      ? Math.floor((MAX_HAND_HEIGHT - PHONE_SELECTED_LIFT - rowGap - ARC_HEIGHT) / 2) - 1
      : Math.floor((MAX_HAND_HEIGHT - PHONE_SELECTED_LIFT)) - 1;
    cardHeightCap = Math.min(cardHeightCap, cardHeight, shrinkTarget) - 1;
    if (cardHeightCap < 44) {
      break;
    }
  }

  return {
    cardWidth: 0,
    cardHeight: 0,
    height: 0,
    selectedLift: PHONE_SELECTED_LIFT,
    rowStride: 0,
    rows: 0,
    positions: []
  };
}
