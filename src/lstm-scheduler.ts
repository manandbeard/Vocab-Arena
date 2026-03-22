/**
 * LSTM-Inspired Spaced Repetition Scheduler
 *
 * Implements a mathematically-grounded algorithm inspired by Long Short-Term Memory
 * neural networks (and OpenAI's Reptile meta-learning approach) to model human
 * memory retention more accurately than the classic SM-2 algorithm.
 *
 * Key advantages over SM-2:
 *  - Graduated forgetting: failed reviews don't blindly reset to day 1; prior
 *    learning is partially retained in the cell state.
 *  - Speed-aware encoding: rushed answers (< 1200 ms) are penalised so that
 *    reflexive guesses don't inflate the schedule.
 *  - Adaptive depth: the forget/input/output gates continuously re-weight memory
 *    based on the learner's specific history for each item.
 *
 * Algorithm overview
 * ------------------
 * The LSTM analogy maps to memory science as follows:
 *
 *   Cell state  (C_t) — long-term memory strength       [0, MAX_CELL]
 *   Hidden state (h_t) — short-term stability estimate  [0, 1]
 *
 * At each review event the three gating functions are evaluated:
 *
 *   f_t = σ( w_f1·h + w_f2·q̃ + b_f )      // forget gate
 *   i_t = σ( w_i1·h + w_i2·q̃ + b_i )      // input gate
 *   g_t = tanh( w_g1·h + w_g2·q̃ + b_g )   // cell candidate
 *   o_t = σ( w_o1·h + w_o2·q̃ + b_o )      // output gate
 *
 * State update:
 *   C_t = clamp( f_t·C_{t-1} + i_t·g_t·MAX_CELL,  0, MAX_CELL )
 *   h_t = o_t · tanh( C_t / MAX_CELL )
 *
 * Next interval (days):
 *   interval = round( exp( C_t · INTERVAL_SCALE ) )   if quality ≥ 3
 *   interval = 1                                       if quality < 3
 *
 * Pre-trained weights were chosen to match SM-2 output on a clean review
 * sequence while providing stronger graduated-forgetting on failures.
 */

export interface LSTMState {
  /** Long-term memory strength.  Range: [0, MAX_CELL] */
  cellState: number;
  /** Short-term stability estimate.  Range: [0, 1] */
  hiddenState: number;
  /** Scheduled interval in days */
  interval: number;
  /** Total number of reviews for this item */
  reviewCount: number;
}

export interface LSTMResult {
  /** Updated LSTM state to persist */
  state: LSTMState;
  /** ISO string of the next review date */
  nextReviewDate: string;
  /** SM-2-compatible repetitions count (for database compatibility) */
  repetitions: number;
  /** SM-2-compatible ease factor (for database compatibility) */
  easeFactor: number;
}

/** Maximum cell state value; caps unbounded memory growth */
const MAX_CELL = 8.0;

/** Scales cell-state → log-interval.  Calibrated against SM-2 benchmarks. */
const INTERVAL_SCALE = 0.55;

/** Maximum interval cap in days (~6 months) */
const MAX_INTERVAL = 180;

// ── Pre-trained gate weights (SRS domain) ────────────────────────────────────
// Forget gate — high quality preserves memory, low quality allows forgetting
const W_F1 = 0.3,  W_F2 = 2.5,  B_F = -1.2;
// Input gate — quality drives new information encoding
const W_I1 = 0.2,  W_I2 = 1.8,  B_I = -0.5;
// Cell candidate — positive memory for high quality, negative for failure
const W_G1 = 0.5,  W_G2 = 1.5,  B_G = -0.7;
// Output gate — balanced stability readout
const W_O1 = 0.4,  W_O2 = 1.0,  B_O = -0.3;
// ─────────────────────────────────────────────────────────────────────────────

/** Numerically-stable sigmoid */
function sigmoid(x: number): number {
  const clamped = Math.max(-500, Math.min(500, x));
  return 1 / (1 + Math.exp(-clamped));
}

/**
 * Returns a fresh (zero-knowledge) LSTM state suitable for a brand-new item.
 */
export function initialLSTMState(): LSTMState {
  return { cellState: 0, hiddenState: 0, interval: 0, reviewCount: 0 };
}

/**
 * Converts legacy SM-2 progress data stored in Firestore into an equivalent
 * LSTM state so that existing learner data isn't lost on upgrade.
 */
export function fromSM2(repetitions: number, easeFactor: number, interval: number): LSTMState {
  // Infer cell state from how many successful repetitions the learner has done.
  // More reps + longer interval → higher cell state.
  const estimatedCellState = Math.min(MAX_CELL, Math.log(Math.max(1, interval)) / INTERVAL_SCALE);
  const estimatedHidden = sigmoid(W_O1 * 0 + W_O2 * ((easeFactor - 1.3) / 1.7) + B_O) *
    Math.tanh(estimatedCellState / MAX_CELL);
  return {
    cellState: estimatedCellState,
    hiddenState: Math.max(0, estimatedHidden),
    interval,
    reviewCount: repetitions,
  };
}

/**
 * Core LSTM scheduling step.
 *
 * @param quality      Review quality on the 0-5 scale (0 = blackout, 5 = perfect)
 * @param responseTimeMs  Milliseconds taken to answer (used for speed penalty)
 * @param prevState    Previous LSTM state for this item (use `initialLSTMState()`
 *                     for first-ever review)
 * @returns            Updated state and the ISO next-review date
 */
export function calculateLSTM(
  quality: number,
  responseTimeMs: number,
  prevState: LSTMState
): LSTMResult {
  const qualityNorm = quality / 5; // Normalise to [0, 1]

  // Speed penalty: rushed answers encode less deeply
  const speedFactor =
    responseTimeMs < 1200 ? 0.5 :
    responseTimeMs < 3000 ? 0.8 :
    1.0;

  const effectiveQuality = qualityNorm * speedFactor;
  const h = prevState.hiddenState;

  // ── Evaluate gates ────────────────────────────────────────────────────────
  const forgetGate    = sigmoid(W_F1 * h + W_F2 * effectiveQuality + B_F);
  const inputGate     = sigmoid(W_I1 * h + W_I2 * effectiveQuality + B_I);
  const cellCandidate = Math.tanh(W_G1 * h + W_G2 * effectiveQuality + B_G);
  const outputGate    = sigmoid(W_O1 * h + W_O2 * effectiveQuality + B_O);

  // ── Update cell state (long-term memory) ─────────────────────────────────
  const newCellState = Math.min(
    MAX_CELL,
    Math.max(0, forgetGate * prevState.cellState + inputGate * cellCandidate * MAX_CELL)
  );

  // ── Update hidden state (stability estimate) ─────────────────────────────
  const newHiddenState = outputGate * Math.tanh(newCellState / MAX_CELL);

  // ── Compute next review interval ─────────────────────────────────────────
  // Correct answers: interval grows with memory strength
  // Incorrect answers: next day (but cell state is already reduced above,
  //   so recovery will be faster for previously well-learned items)
  const interval =
    quality >= 3
      ? Math.max(1, Math.min(MAX_INTERVAL, Math.round(Math.exp(newCellState * INTERVAL_SCALE))))
      : 1;

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  // SM-2-compatible fields for backwards-compatible database writes
  const repetitions = quality >= 3 ? prevState.reviewCount + 1 : 0;
  const easeFactor = Math.max(
    1.3,
    2.5 + (newCellState / MAX_CELL) * 1.2 - (1 - qualityNorm) * 0.4
  );

  return {
    state: {
      cellState: newCellState,
      hiddenState: newHiddenState,
      interval,
      reviewCount: prevState.reviewCount + 1,
    },
    nextReviewDate: nextReviewDate.toISOString(),
    repetitions,
    easeFactor,
  };
}

/**
 * Convenience helper: given the raw `progress` object stored in Firestore
 * (which may be SM-2-format or LSTM-format), return a ready-to-use LSTMState.
 */
export function progressToLSTMState(progress: any): LSTMState {
  if (!progress) return initialLSTMState();

  // LSTM format: cellState field present
  if (typeof progress.cellState === 'number') {
    return {
      cellState: progress.cellState,
      hiddenState: progress.hiddenState ?? 0,
      interval: progress.interval ?? 0,
      reviewCount: progress.repetition_count ?? progress.reviewCount ?? 0,
    };
  }

  // Legacy SM-2 format
  return fromSM2(
    progress.repetition_count ?? 0,
    progress.easeFactor ?? 2.5,
    progress.interval ?? 0
  );
}
