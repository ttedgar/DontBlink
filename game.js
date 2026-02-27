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

function lightenHex(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (n >> 16)         + amt);
  const g = Math.min(255, ((n >> 8) & 0xff) + amt);
  const b = Math.min(255, (n & 0xff)        + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function pickColorPair() {
  const shuffled = [...COLORS].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

// ── Game Class ────────────────────────────────────────────
class DontBlink {
  constructor() {
    // DOM refs — game
    this.$game      = document.getElementById('game');
    this.$startBtn  = document.getElementById('startBtn');
    this.$roundInd  = document.getElementById('roundIndicator');
    this.$gameMsgEl = document.getElementById('gameMessage');
    this.$msgText   = document.getElementById('messageText');
    this.$scoreDots = document.getElementById('scoreDots');
    this.$bestScore = document.getElementById('bestScoreDisplay');

    // DOM refs — results
    this.$finalScore     = document.getElementById('finalScore');
    this.$rankDisplay    = document.getElementById('rankDisplay');
    this.$scoreBreakdown = document.getElementById('scoreBreakdown');
    this.$playerName     = document.getElementById('playerName');
    this.$saveNameBtn    = document.getElementById('saveNameBtn');
    this.$playAgainBtn   = document.getElementById('playAgainBtn');
    this.$shareBtn       = document.getElementById('shareBtn');
    this.$shareFeedback  = document.getElementById('shareFeedback');
    this.$leaderboard    = document.getElementById('leaderboard');

    // Game state
    this.state     = 'idle';
    this.roundNum  = 0;
    this.scores    = [];
    this.fromColor = null;
    this.toColor   = null;
    this.changeAt  = null;

    // Results state
    this._avg          = 0;
    this._submitted    = false;
    this._myTs         = null;
    this._myRankResult = null;

    this._waitTimer  = null;
    this._fakeTimer  = null;
    this._fakeRevert = null;
    this._pauseTimer = null;

    this._bindEvents();
    this._refreshBestScore();
  }

  // ── Events ──────────────────────────────────────────────
  _bindEvents() {
    this.$startBtn.addEventListener('click',  () => this._startGame());
    this.$game.addEventListener('click',      () => this._onGameClick());
    this.$game.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._onGameClick();
    }, { passive: false });

    this.$playAgainBtn.addEventListener('click', () => this._goToIntro());
    this.$shareBtn.addEventListener('click',     () => this._share());

    // Name submission: button click or Enter key
    this.$saveNameBtn.addEventListener('click', () => this._submitToLeaderboard());
    this.$playerName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitToLeaderboard();
    });
  }

  // ── Screen Management ────────────────────────────────────
  _showScreen(id) {
    ['intro', 'results'].forEach(screenId => {
      document.getElementById(screenId).classList.remove('active');
    });
    if (id === 'intro' || id === 'results') {
      document.getElementById(id).classList.add('active');
    }
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
    this._showScreen('game');
    this._updateDots();
    this._beginRound();
  }

  _beginRound() {
    this._clearAllTimers();
    this.roundNum++;
    this._setState('waiting');
    this._updateRoundIndicator();

    [this.fromColor, this.toColor] = pickColorPair();
    this._setBg(this.fromColor);
    this._setMsg('Click anywhere when the color changes', false);

    const hasFake = Math.random() < CFG.FAKE_CHANCE;

    if (hasFake) {
      const fakeDelay = rand(CFG.FAKE_MIN_DELAY, CFG.FAKE_MAX_DELAY);
      this._fakeTimer = setTimeout(() => {
        if (this.state !== 'waiting') return;
        this._triggerFake();

        const realDelay = CFG.FAKE_DURATION + rand(CFG.REAL_AFTER_FAKE, CFG.REAL_AFTER_FAKE + 1500);
        this._waitTimer = setTimeout(() => {
          if (this.state !== 'waiting') return;
          this._triggerChange();
        }, realDelay);
      }, fakeDelay);
    } else {
      const delay = rand(CFG.MIN_DELAY, CFG.MAX_DELAY);
      this._waitTimer = setTimeout(() => {
        if (this.state !== 'waiting') return;
        this._triggerChange();
      }, delay);
    }
  }

  _triggerFake() {
    const fakeColor = lightenHex(this.fromColor, 65);
    this._setBg(fakeColor);
    this._fakeRevert = setTimeout(() => {
      if (this.state === 'waiting') this._setBg(this.fromColor);
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
  }

  _tooEarly() {
    this._clearAllTimers();
    this._setState('paused');
    this._setBg('#3d0000');
    this._setMsg('Too early! ⚡', true);

    this.$game.classList.remove('shake');
    void this.$game.offsetWidth;
    this.$game.classList.add('shake');

    this._pauseTimer = setTimeout(() => {
      this.$game.classList.remove('shake');
      this.roundNum--;
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
  async _showResults() {
    this._avg          = Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
    this._submitted    = false;
    this._myTs         = null;
    this._myRankResult = null;

    // Persist best
    const best = parseInt(localStorage.getItem('db_best') || '999999', 10);
    if (this._avg < best) localStorage.setItem('db_best', this._avg);

    // Populate score UI
    this.$finalScore.textContent = `${this._avg}ms`;
    this.$scoreBreakdown.innerHTML = this.scores
      .map((s, i) => `<span class="round-pill">R${i + 1}: ${s}ms</span>`)
      .join('');

    // Reset rank display and save button
    this.$rankDisplay.textContent = '';
    this.$rankDisplay.className   = 'rank-display';
    this.$saveNameBtn.textContent = 'Save';
    this.$saveNameBtn.disabled    = false;

    // Pre-fill name from last session
    const savedName = localStorage.getItem('db_name');
    if (savedName) this.$playerName.value = savedName;

    this._showScreen('results');
    this._refreshBestScore();

    // Show preview rank and initial leaderboard in parallel
    const [peek] = await Promise.all([
      Leaderboard.peek(this._avg),
      this._renderLeaderboard(null),
    ]);
    this._updateRankDisplay(peek, false);
  }

  // ── Leaderboard ──────────────────────────────────────────
  _updateRankDisplay(rankResult, submitted) {
    if (!rankResult) {
      this.$rankDisplay.textContent = submitted ? 'Outside the top 100' : '';
      this.$rankDisplay.className   = 'rank-display unranked';
      return;
    }

    const { rank, isTied } = rankResult;
    const tied = isTied ? 'Tied for ' : '';

    if (submitted) {
      this.$rankDisplay.textContent = `${tied}#${rank} of 100`;
      this.$rankDisplay.className   = 'rank-display confirmed';
    } else {
      this.$rankDisplay.textContent = `You'd be ${tied}#${rank}`;
      this.$rankDisplay.className   = 'rank-display preview';
    }
  }

  async _submitToLeaderboard() {
    if (this._submitted) return;
    const name = this.$playerName.value.trim();
    if (!name) {
      this.$playerName.focus();
      return;
    }

    this._submitted = true;
    localStorage.setItem('db_name', name);
    this.$saveNameBtn.textContent = 'Saved ✓';
    this.$saveNameBtn.disabled    = true;

    const result = await Leaderboard.submit(name, this._avg);
    this._myRankResult = result;

    if (result) this._myTs = result.ts;

    this._updateRankDisplay(result, true);
    await this._renderLeaderboard(this._myTs);
  }

  async _renderLeaderboard(myTs) {
    const entries = await Leaderboard.getTop(10);

    if (entries.length === 0) {
      this.$leaderboard.innerHTML = '<p class="lb-empty">Be the first on the board.</p>';
      return;
    }

    const myIndexInTop10 = myTs != null
      ? entries.findIndex(e => e.ts === myTs)
      : -1;

    let html = '<p class="lb-header">Leaderboard</p>';

    for (const e of entries) {
      const isYou = e.ts === myTs;
      const star  = isYou ? '★ ' : '';
      html += `
        <div class="lb-row${isYou ? ' lb-you' : ''}">
          <span class="lb-rank">#${e.rank}</span>
          <span class="lb-name">${star}${this._esc(e.name)}</span>
          <span class="lb-score">${e.score}ms</span>
        </div>`;
    }

    // Player submitted but landed outside the top 10 — append with separator
    if (myTs != null && myIndexInTop10 === -1 && this._myRankResult) {
      const r    = this._myRankResult;
      const name = this.$playerName.value.trim() || 'You';
      html += `
        <div class="lb-sep">···</div>
        <div class="lb-row lb-you">
          <span class="lb-rank">#${r.rank}</span>
          <span class="lb-name">★ ${this._esc(name)}</span>
          <span class="lb-score">${this._avg}ms</span>
        </div>`;
    }

    this.$leaderboard.innerHTML = html;
  }

  // ── Share ────────────────────────────────────────────────
  _share() {
    let text;
    if (this._myRankResult) {
      const { rank, isTied } = this._myRankResult;
      const tied = isTied ? 'tied for ' : '';
      text = `I'm ${tied}#${rank} with ${this._avg}ms on dontblink.click — can you beat me? ⚡`;
    } else {
      text = `I scored ${this._avg}ms on dontblink.click — can you beat me? ⚡`;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => this._flashShareFeedback())
        .catch(() => this._fallbackCopy(text));
    } else {
      this._fallbackCopy(text);
    }
  }

  _fallbackCopy(text) {
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
      window.prompt('Copy this link:', text);
    }
    document.body.removeChild(ta);
  }

  _flashShareFeedback() {
    this.$shareFeedback.classList.add('visible');
    setTimeout(() => this.$shareFeedback.classList.remove('visible'), 2200);
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
    this.$game.style.transition = 'none';
    this.$game.style.backgroundColor = color;
  }

  _setMsg(text, pop) {
    this.$msgText.textContent = text;
    if (pop) {
      this.$gameMsgEl.classList.remove('pop');
      void this.$gameMsgEl.offsetWidth;
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
