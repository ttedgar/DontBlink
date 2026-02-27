/* ============================================================
   Don't Blink — leaderboard.js
   Firebase Firestore backend.
   ============================================================ */

'use strict';

const Leaderboard = (() => {
  const SIZE = 100;

  // Lazy-init the collection reference
  let _col = null;
  function col() {
    if (!_col) _col = firebase.firestore().collection('scores');
    return _col;
  }

  // Standard (1-2-2-4) ranking
  function withRanks(docs) {
    let rank = 1;
    return docs.map((e, i, a) => {
      if (i > 0 && e.score !== a[i - 1].score) rank = i + 1;
      return { ...e, rank };
    });
  }

  return {
    // Preview rank without submitting.
    // Returns { rank, isTied } or null (outside top 100 / offline).
    async peek(score) {
      try {
        const snap = await col().orderBy('score').limit(SIZE).get();
        const docs  = snap.docs.map(d => d.data());

        if (docs.length >= SIZE && score > docs[docs.length - 1].score) return null;

        const better = docs.filter(d => d.score < score).length;
        const isTied = docs.some(d => d.score === score);
        return { rank: better + 1, isTied };
      } catch {
        return null;
      }
    },

    // Submit a score. Returns { rank, isTied, ts } or null.
    async submit(name, score) {
      try {
        const ref = await col().add({
          name,
          score,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        // Re-fetch top 100 to confirm entry made the cut and calculate rank
        const snap = await col().orderBy('score').limit(SIZE).get();
        const docs  = snap.docs.map(d => ({ ...d.data(), ts: d.id }));

        if (!docs.some(d => d.ts === ref.id)) return null;

        const better = docs.filter(d => d.score < score).length;
        const isTied = docs.filter(d => d.score === score).length > 1;
        return { rank: better + 1, isTied, ts: ref.id };
      } catch {
        return null;
      }
    },

    // Top N entries with standard ranks applied.
    async getTop(n = 10) {
      try {
        const snap = await col().orderBy('score').limit(SIZE).get();
        const docs  = snap.docs.map(d => ({ ...d.data(), ts: d.id }));
        return withRanks(docs).slice(0, n);
      } catch {
        return [];
      }
    },
  };
})();
