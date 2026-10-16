/* First-run coach overlay steps (persisted under turdanoid_v3_coach_v1). */
(function attachTurdanoidCoach(root) {
  'use strict';

  const COACH_STORAGE_KEY = 'turdanoid_v3_coach_v1';

  const STEPS = [
    { id: 'move', title: 'Move the seat', body: 'Drag anywhere below the HUD, or use ← / → keys.' },
    { id: 'launch', title: 'Launch the turd', body: 'Tap the court or press Space to send the ball.' },
    { id: 'powers', title: 'Catch power-ups', body: 'Capsules fall from bricks — grab them for chaos.' }
  ];

  function coachSeen(storage) {
    try {
      return storage && storage.getItem(COACH_STORAGE_KEY) === '1';
    } catch {
      return true;
    }
  }

  function markCoachSeen(storage) {
    try {
      if (storage) {
        storage.setItem(COACH_STORAGE_KEY, '1');
      }
    } catch { /* ignore */ }
  }

  root.TurdanoidCoach = {
    COACH_STORAGE_KEY,
    STEPS,
    coachSeen,
    markCoachSeen
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
