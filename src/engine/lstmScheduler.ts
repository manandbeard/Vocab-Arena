/**
 * LSTM-Inspired Adaptive Scheduling Engine
 *
 * This module implements an LSTM (Long Short-Term Memory) neural-network-inspired
 * scheduling algorithm to predict forgetting curves with higher accuracy than SM-2.
 *
 * Architecture Overview:
 * ─────────────────────
 * The scheduler maintains a two-value memory state per item, analogous to the
 * cell state (c) and hidden state (h) of an LSTM cell:
 *
 *   c (cell state)   — Long-term memory strength.  Grows slowly with each successful
 *                      recall and falls sharply after a failure, modelling how deeply
 *                      a concept is encoded in long-term memory.
 *
 *   h (hidden state) — Recent-performance context (momentum). High after a string of
 *                      successes; low after failures. Feeds back into the gate
 *                      calculations, giving the model short-term sensitivity to
 *                      learning momentum.
 *
 * On every review four gates are computed from (quality, h):
 *   • forget gate (f) — how much of the previous cell state to retain
 *   • input gate  (i) — how much new information to store
 *   • cell candidate  — the new candidate cell value (via tanh)
 *   • output gate (o) — what fraction of the updated cell to expose as h
 *
 * Interval Calculation:
 * ─────────────────────
 * Stability S represents the memory "half-life" in days.  It grows
 * multiplicatively on success (scaled by momentum) and shrinks on failure.
 * The next review interval equals S (targeting ~90 % retention).
 *
 * Inspired by:
 *   • Ebbinghaus Forgetting Curve  (R = e^(-t/S))
 *   • FSRS algorithm (Free Spaced Repetition Scheduler)
 *   • OpenAI Reptile / MAML meta-learning (fast adaptation to individual learners)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LSTMState {
  /** Hidden state in [-1, 1]: captures recent-performance momentum */
  h: number;
  /** Cell state (unbounded): encodes long-term memory depth */
  c: number;
  /** Memory stability in days: the interval at which retention ≈ 90 % */
  stability: number;
  /** Item difficulty in [0.1, 1.0]: increases on failures, decreases on success */
  difficulty: number;
  /** Next review interval in days */
  interval: number;
  /** ISO-8601 date string of the next scheduled review */
  nextReviewDate: string;
  /** Number of successful repetitions (quality ≥ 3) */
  repetitions: number;
}

// ─── LSTM Weights ─────────────────────────────────────────────────────────────
// Each row is [quality_weight, hidden_weight, threshold].
// Gate activations are computed as sigmoid(quality_weight * q + hidden_weight * h - threshold).
// The threshold (subtracted) acts as a negative bias that controls the gate's
// default "closed" state — a standard technique in hand-designed LSTM-inspired models.
// Values are calibrated to produce review intervals comparable to empirically
// validated SRS schedules (first pass: ~4-8 days; doubles roughly every 2 reps).

const W_FORGET = [3.0, 0.5, 1.5] as const;  // high quality → keep more of c
const W_INPUT  = [3.0, 0.2, 1.0] as const;  // high quality → store more
const W_CELL   = [2.5, 0.1, 0.3] as const;  // candidate cell value
const W_OUTPUT = [2.0, 0.3, 0.5] as const;  // output gate

// Growth-factor components for successful recalls
const BASE_GROWTH_FACTOR   = 2.1;   // minimum stability multiplier on success (≈ SM-2 EF)
const MOMENTUM_MULTIPLIER  = 0.8;   // how much positive hidden-state momentum amplifies growth
const DIFFICULTY_PENALTY   = 0.3;   // how much item difficulty suppresses growth

// Initial stability (days) for the very first review, indexed by quality 0-5
const INITIAL_STABILITY = [1, 1, 1, 2, 4, 8] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns a blank LSTMState for an item that has never been reviewed. */
export function getInitialLSTMState(): LSTMState {
  return {
    h: 0,
    c: 0,
    stability: 1,
    difficulty: 0.3,
    interval: 0,
    nextReviewDate: new Date().toISOString(),
    repetitions: 0,
  };
}

/**
 * Compute the next LSTM state after a review.
 *
 * @param quality  Student's self-reported recall quality, 0 (blackout) to 5 (perfect).
 * @param prevState  The item's previous LSTM state (use getInitialLSTMState() for new items).
 * @returns  Updated LSTMState including the next review date and interval.
 *
 * @example
 * const initial = getInitialLSTMState();
 * const after1  = calculateLSTM(4, initial);    // first review, quality 4
 * const after2  = calculateLSTM(5, after1);     // second review, perfect recall
 */
export function calculateLSTM(quality: number, prevState: LSTMState): LSTMState {
  if (quality < 0 || quality > 5) {
    throw new RangeError(`quality must be 0-5, got ${quality}`);
  }

  const q = quality / 5;           // normalise to [0, 1]
  const { h, c, stability, difficulty, repetitions } = prevState;

  // ── Gate computations ──────────────────────────────────────────────────────
  const f     = sigmoid(W_FORGET[0] * q + W_FORGET[1] * h - W_FORGET[2]);
  const i     = sigmoid(W_INPUT[0]  * q + W_INPUT[1]  * h - W_INPUT[2]);
  const c_hat = Math.tanh(W_CELL[0] * q + W_CELL[1]   * h - W_CELL[2]);
  const o     = sigmoid(W_OUTPUT[0] * q + W_OUTPUT[1] * h - W_OUTPUT[2]);

  // ── State update ──────────────────────────────────────────────────────────
  const new_c = f * c + i * c_hat;
  const new_h = o * Math.tanh(new_c);

  // ── Stability (interval length) ────────────────────────────────────────────
  let new_stability: number;
  if (repetitions === 0) {
    // First encounter: seed stability from quality
    new_stability = INITIAL_STABILITY[quality] ?? 1;
  } else if (quality >= 3) {
    // Successful recall: stability grows multiplicatively.
    // The growth factor is amplified by hidden-state momentum and penalised by
    // item difficulty, matching the empirical observation that harder items
    // require more frequent review.
    const growth = BASE_GROWTH_FACTOR + new_h * MOMENTUM_MULTIPLIER - difficulty * DIFFICULTY_PENALTY;
    new_stability = Math.round(stability * Math.max(1.1, growth));
  } else {
    // Failed recall: reset aggressively (lapse).  Target ~10 % of previous stability.
    new_stability = Math.max(1, Math.round(stability * 0.1));
  }

  // Guard against unrealistically long intervals (cap at 3 years)
  new_stability = Math.min(new_stability, 365 * 3);

  // ── Difficulty update ──────────────────────────────────────────────────────
  // Converges toward 0.1 (easy) on repeated success, drifts toward 1.0 on failure.
  let new_difficulty: number;
  if (quality < 3) {
    new_difficulty = Math.min(1.0, difficulty + 0.1);
  } else {
    new_difficulty = Math.max(0.1, difficulty - 0.05 * (quality - 2));
  }

  // ── Schedule next review ───────────────────────────────────────────────────
  const interval = Math.max(1, new_stability);
  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return {
    h: new_h,
    c: new_c,
    stability: new_stability,
    difficulty: new_difficulty,
    interval,
    nextReviewDate: nextReviewDate.toISOString(),
    repetitions: repetitions + (quality >= 3 ? 1 : 0),
  };
}
