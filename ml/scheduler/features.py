"""
Feature extraction from review_events into LSTM training sequences.

Each timestep for a (user, card) pair has the following features:
  0  time_since_last_review   (days, normalised by log1p)
  1  previous_interval        (days, normalised by log1p)
  2-6  rating one-hot          (bins: 0,1,2,3,4 → one-hot 5-dim)
  7  cumulative_successes      (normalised by log1p)
  8  cumulative_lapses         (normalised by log1p)
  9  card_difficulty           (0-1, already normalised)
  10 concept_tag_hash          (single float in [0,1] derived from tag set)

INPUT_SIZE = 11
"""
import math
from typing import List, Dict, Any, Tuple

INPUT_SIZE = 11
MAX_INTERVAL_DAYS = 365 * 3  # 3 years cap for normalisation

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _log1p_norm(x: float, scale: float = 1.0) -> float:
    """Apply log1p normalisation, optionally with a scale divisor."""
    return math.log1p(max(x, 0.0)) / scale


def _tag_hash(tags: List[str]) -> float:
    """Collapse a list of tags into a single float in [0, 1]."""
    if not tags:
        return 0.0
    h = 0
    for t in tags:
        for ch in t:
            h = (h * 31 + ord(ch)) & 0xFFFFFF
    return h / 0xFFFFFF


def _rating_onehot(rating: float) -> List[float]:
    """Map a 0-5 float rating into a 5-bin one-hot vector (bins 0-4)."""
    clamped = max(0.0, min(rating, 4.999))
    rounded = int(round(clamped))
    idx = min(rounded, 4)
    v = [0.0] * 5
    v[idx] = 1.0
    return v


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #

def extract_sequence(
    events: List[Dict[str, Any]],
    card_difficulty: float = 0.5,
    concept_tags: List[str] | None = None,
) -> Tuple[List[List[float]], List[int]]:
    """
    Convert a chronologically-sorted list of review_events for a single
    (user, card) pair into (feature_sequences, labels).

    Parameters
    ----------
    events : list of dicts with keys
        - timestamp   : ISO-8601 string or datetime
        - rating      : float 0-5
        - latency_ms  : int or None
        - was_hint_used : bool
        (other keys are silently ignored)
    card_difficulty : float 0-1
    concept_tags    : list[str]

    Returns
    -------
    sequences : list[list[float]]  – one feature vector per event (except last)
    labels    : list[int]          – 1 if next rating >= 3, else 0
    """
    from datetime import datetime, timezone

    if concept_tags is None:
        concept_tags = []

    tag_f = _tag_hash(concept_tags)
    log_scale = math.log1p(MAX_INTERVAL_DAYS)

    # Parse timestamps
    parsed: List[Tuple[datetime, Dict]] = []
    for ev in events:
        ts = ev["timestamp"]
        if isinstance(ts, str):
            # Handle timezone-aware and naive strings
            ts = ts.replace("Z", "+00:00")
            try:
                dt = datetime.fromisoformat(ts)
            except ValueError:
                dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S")
                dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = ts
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        parsed.append((dt, ev))

    parsed.sort(key=lambda x: x[0])

    sequences: List[List[float]] = []
    labels: List[int] = []

    cum_success = 0
    cum_lapse = 0
    prev_time: datetime | None = None
    prev_interval_days = 0.0

    for i, (dt, ev) in enumerate(parsed):
        rating = float(ev.get("rating", 0))

        if i == 0:
            time_since = 0.0
        else:
            delta = (dt - prev_time).total_seconds()
            time_since = delta / 86400.0  # → days

        feat: List[float] = [
            _log1p_norm(time_since, log_scale),
            _log1p_norm(prev_interval_days, log_scale),
            *_rating_onehot(rating),
            _log1p_norm(cum_success),
            _log1p_norm(cum_lapse),
            float(card_difficulty),
            float(tag_f),
        ]
        assert len(feat) == INPUT_SIZE, f"Expected {INPUT_SIZE} features, got {len(feat)}"

        # Only add (feat, label) when there is a *next* event to label
        if i < len(parsed) - 1:
            next_rating = float(parsed[i + 1][1].get("rating", 0))
            label = 1 if next_rating >= 3.0 else 0
            sequences.append(feat)
            labels.append(label)

        # Update accumulators for next step
        if rating >= 3.0:
            cum_success += 1
        else:
            cum_lapse += 1
        prev_interval_days = time_since
        prev_time = dt

    return sequences, labels
