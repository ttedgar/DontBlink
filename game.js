/* ============================================================
   Don't Blink — game.js
   ============================================================ */

'use strict';

// ── Config ────────────────────────────────────────────────
const CFG = {
  ROUNDS:            5,
  MIN_DELAY:         2000,   // ms before real color change
  MAX_DELAY:         6000,
  FAKE_CHANCE:       0.38,   // probability of a trick round
  FAKE_MIN_DELAY:    1200,   // earliest a fake can happen
  FAKE_MAX_DELAY:    3500,   // latest a fake can start
  FAKE_DURATION:     130,    // how long the fake flash lasts (ms)
  REAL_AFTER_FAKE:   900,    // min gap between fake-end and real change
  RESULT_PAUSE:      1100,   // ms to show score before next round
  TOO_EARLY_PAUSE:   1400,   // ms to show "Too early!" before retry
};

// A palette of clearly distinct, dark-enough colors for white text
const COLORS = [
  '#1a1a2e',  // midnight navy
  '#c1121f',  // deep red
  '#1b4332',  // forest
  '#5a189a',  // violet
  '#006466',  // dark teal
  '#9b2226',  // crimson
  '#023e8a',  // royal blue
  '#74290f',  // burnt umber
  '#3d405b',  // slate
  '#184e77',  // ocean
];

// ── Utility ───────────────────────────────────────────────
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

// Lighten a hex color by `amt` per channel (clamped to 255)
function lightenHex(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (n >> 16)         + amt);
  const g = Math.min(255, ((n >> 8) & 0xff) + amt);
  const b = Math.min(255, (n & 0xff)        + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Pick two distinct random colors from the palette
function pickColorPair() {
  const shuffled = [...COLORS].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

// ── Game Class ────────────────────────────────────────────
class DontBlink {
  constructor() {
    // DOM refs
    this.$intro     = document.getElementById('intro');
    this.$game      = document.getElementById('game');
    this.$results   = document.getElementById('results');
    this.$startBtn  = document.getElementById('startBtn');
    this.$roundInd  = document.getElementById('roundIndicator');
    this.$gameMsgEl = document.getElementById('gameMessage');
    this.$msgText   = document.getElementById('messageText');
    this.$scoreDots = document.getElementById('scoreDots');
    this.$finalScore      = document.getElementById('finalScore');
    this.$scoreBreakdown  = document.getElementById('scoreBreakdown');
    this.$playerName      = document.getElementById('playerName');
    this.$playAgainBtn    = document.getElementById('playAgainBtn');
    this.$shareBtn        = document.getElementById('shareBtn');
    this.$shareFeedback   = document.getElementById('shareFeedback');
    this.$bestScore       = document.getElementById('bestScoreDisplay');
    this.$historySection  = document.getElementById('historySection');

    // State
    this.state        = 'idle';   // idle | waiting | ready | paused
    this.roundNum     = 0;        // 1-based, current round
    this.scores       = [];       // collected round times (ms)
    this.fromColor    = null;
    this.toColor      = null;
    this.changeAt     = null;     // performance.now() when color changed
    this._waitTimer   = null;
    this._fakeTimer   = null;
    this._fakeRevert  = null;
    this._pauseTimer  = null;

    this._bindEvents();
    this._refreshBestScore();
  }

  // ── Events ──────────────────────────────────────────────
  _bindEvents() {
    this.$startBtn.addEventListener('click',    () => this._startGame());
    this.$game.addEventListener('click',        () => this._onGameClick());
    this.$game.addEventListener('touchstart',   (e) => { e.preventDefault(); this._onGameClick(); },
                                { passive: false });
    this.$playAgainBtn.addEventListener('click', () => this._goToIntro());
    this.$shareBtn.addEventListener('click',     () => this._share());
    this.$playerName.addEventListener('change',  () => this._saveName());
  }

  // ── Screen Management ────────────────────────────────────
  _showScreen(id) {
    ['intro', 'results'].forEach(screenId => {
      document.getElementById(screenId).classList.remove('active');
    });
    if (id === 'intro' || id === 'results') {
      document.getElementById(id).classList.add('active');
    }
    // The game screen is always visible behind; we just toggle overlays
  }

  // ── Best Score ───────────────────────────────────────────
  _refreshBestScore() {
    const best = localStorage.getItem('db_best');
    this.$bestScore.textContent = best ? `Best: ${best}ms` : '';
  }

  // ── Game Flow ────────────────────────────────────────────
  _startGame() {
    this.roundNum = 0;
    this.scores   = [];
    this._showScreen('game');   // hide intro overlay
    this._updateDots();
    this._beginRound();
  }

  _beginRound() {
    this._clearAllTimers();
    this.roundNum++;
    this._setState('waiting');
    this._updateRoundIndicator();

    // Pick a color pair for this round
    [this.fromColor, this.toColor] = pickColorPair();
    this._setBg(this.fromColor);
    this._setMsg('Click anywhere when the color changes', false);

    // Decide whether this round has a fake
    const hasFake = Math.random() < CFG.FAKE_CHANCE;

    if (hasFake) {
      // Schedule fake first, then real change after fake clears
      const fakeDelay = rand(CFG.FAKE_MIN_DELAY, CFG.FAKE_MAX_DELAY);
      this._fakeTimer = setTimeout(() => {
        if (this.state !== 'waiting') return;
        this._triggerFake();

        // Schedule real change after fake clears + gap
        const realDelay = CFG.FAKE_DURATION + rand(CFG.REAL_AFTER_FAKE, CFG.REAL_AFTER_FAKE + 1500);
        this._waitTimer = setTimeout(() => {
          if (this.state !== 'waiting') return;
          this._triggerChange();
        }, realDelay);
      }, fakeDelay);
    } else {
      // Straight to the real change
      const delay = rand(CFG.MIN_DELAY, CFG.MAX_DELAY);
      this._waitTimer = setTimeout(() => {
        if (this.state !== 'waiting') return;
        this._triggerChange();
      }, delay);
    }
  }

  _triggerFake() {
    // Briefly flash a lighter version of the current color, then revert
    const fakeColor = lightenHex(this.fromColor, 65);
    this._setBg(fakeColor);
    this._fakeRevert = setTimeout(() => {
      if (this.state === 'waiting') {
        this._setBg(this.fromColor);
      }
    }, CFG.FAKE_DURATION);
  }

  _triggerChange() {
    this._setState('ready');
    this.changeAt = performance.now();
    this._setBg(this.toColor);
    this._setMsg('NOW!', true);
  }

  // ── Click Handler ────────────────────────────────────────
  _onGameClick() {
    if (this.state === 'waiting') {
      this._tooEarly();
    } else if (this.state === 'ready') {
      const ms = Math.round(performance.now() - this.changeAt);
      this._recordScore(ms);
    }
    // Ignore clicks during 'paused' or 'idle'
  }

  _tooEarly() {
    this._clearAllTimers();
    this._setState('paused');
    this._setBg('#3d0000');   // deep danger red — immediate visual feedback
    this._setMsg('Too early! ⚡', true);

    // Shake the game screen
    this.$game.classList.remove('shake');
    void this.$game.offsetWidth; // force reflow
    this.$game.classList.add('shake');

    this._pauseTimer = setTimeout(() => {
      this.$game.classList.remove('shake');
      this.roundNum--;  // undo the increment so this round replays
      this._beginRound();
    }, CFG.TOO_EARLY_PAUSE);
  }

  _recordScore(ms) {
    this._clearAllTimers();
    this._setState('paused');
    this.scores.push(ms);
    this._setMsg(`${ms}ms`, true);
    this._updateDots();

    this._pauseTimer = setTimeout(() => {
      if (this.scores.length >= CFG.ROUNDS) {
        this._showResults();
      } else {
        this._beginRound();
      }
    }, CFG.RESULT_PAUSE);
  }

  // ── Results ──────────────────────────────────────────────
  _showResults() {
    const avg  = Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
    const best = parseInt(localStorage.getItem('db_best') || '999999', 10);

    // Persist best
    if (avg < best) {
      localStorage.setItem('db_best', avg);
    }

    // Pre-fill name BEFORE saving history so the entry uses the right name
    const savedName = localStorage.getItem('db_name');
    if (savedName) this.$playerName.value = savedName;

    // Save to history
    this._saveToHistory(avg);

    // Populate results UI
    this.$finalScore.textContent = `${avg}ms`;

    this.$scoreBreakdown.innerHTML = this.scores
      .map((s, i) => `<span class="round-pill">R${i + 1}: ${s}ms</span>`)
      .join('');

    this._renderHistory();
    this._showScreen('results');
    this._refreshBestScore();
  }

  // ── Local Storage ─────────────────────────────────────────
  _saveToHistory(avg) {
    // Use whatever is currently in the name field; don't overwrite db_name here
    const name = this.$playerName.value.trim() || 'Anonymous';

    const history = this._getHistory();
    history.unshift({
      name,
      score: avg,
      date:  new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
    // Keep last 10 entries
    history.splice(10);
    localStorage.setItem('db_history', JSON.stringify(history));
  }

  _getHistory() {
    try {
      return JSON.parse(localStorage.getItem('db_history') || '[]');
    } catch {
      return [];
    }
  }

  _saveName() {
    const name = this.$playerName.value.trim();
    if (name) localStorage.setItem('db_name', name);
  }

  _renderHistory() {
    const history = this._getHistory();
    if (history.length <= 1) {
      this.$historySection.innerHTML = '';
      return;
    }

    const rows = history
      .slice(0, 8)
      .map(h => `
        <div class="history-row">
          <span class="h-name">${this._esc(h.name)}</span>
          <span class="h-score">${h.score}ms</span>
          <span class="h-date">${this._esc(h.date)}</span>
        </div>
      `)
      .join('');

    this.$historySection.innerHTML = `<h3>Your history</h3>${rows}`;
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Share ────────────────────────────────────────────────
  _share() {
    const avg  = Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
    const text = `I scored ${avg}ms on dontblink.click — can you beat me? ⚡`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => this._flashShareFeedback())
        .catch(() => this._fallbackCopy(text));
    } else {
      this._fallbackCopy(text);
    }
  }

  _fallbackCopy(text) {
    // Create a temporary textarea for older browsers / insecure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      this._flashShareFeedback();
    } catch {
      // Last resort: show the text to the user
      window.prompt('Copy this link:', text);
    }
    document.body.removeChild(ta);
  }

  _flashShareFeedback() {
    this.$shareFeedback.classList.add('visible');
    setTimeout(() => this.$shareFeedback.classList.remove('visible'), 2200);
  }

  // ── Navigation ───────────────────────────────────────────
  _goToIntro() {
    this._clearAllTimers();
    this._setState('idle');
    this._showScreen('intro');
    this._refreshBestScore();
  }

  // ── UI Helpers ───────────────────────────────────────────
  _setState(state) {
    this.state = state;
  }

  _setBg(color) {
    // Always instant — no CSS transitions during gameplay
    this.$game.style.transition = 'none';
    this.$game.style.backgroundColor = color;
  }

  _setMsg(text, pop) {
    this.$msgText.textContent = text;
    if (pop) {
      this.$gameMsgEl.classList.remove('pop');
      void this.$gameMsgEl.offsetWidth; // reflow to retrigger animation
      this.$gameMsgEl.classList.add('pop');
    }
  }

  _updateRoundIndicator() {
    this.$roundInd.textContent = `Round ${this.roundNum} of ${CFG.ROUNDS}`;
  }

  _updateDots() {
    const filled = this.scores.map((s, i) => {
      const isNew = i === this.scores.length - 1;
      return `<span class="score-dot${isNew ? ' new' : ''}">${s}ms</span>`;
    });

    const empty = Array(CFG.ROUNDS - this.scores.length)
      .fill('<span class="score-dot empty"></span>');

    this.$scoreDots.innerHTML = [...filled, ...empty].join('');
  }

  // ── Timers ───────────────────────────────────────────────
  _clearAllTimers() {
    clearTimeout(this._waitTimer);
    clearTimeout(this._fakeTimer);
    clearTimeout(this._fakeRevert);
    clearTimeout(this._pauseTimer);
    this._waitTimer  = null;
    this._fakeTimer  = null;
    this._fakeRevert = null;
    this._pauseTimer = null;
  }
}

// ── Bootstrap ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  new DontBlink();
});
