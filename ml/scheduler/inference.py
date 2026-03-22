"""
Inference module: schedule_next_review

Given a (user_id, card_id) pair and the current datetime, returns the earliest
future timestamp at which the predicted recall probability ≈ target_recall.

The scheduler:
  1. Loads the last N review_events from PostgreSQL for (user, card).
  2. Builds the LSTM hidden state from historical events.
  3. Searches geometrically-spaced candidate intervals (10 minutes → 3 years).
  4. Returns the scheduled timestamp and the predicted recall probability.

The model weights are loaded from ml/weights/ (created by train.py).
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import torch

from .features import extract_sequence, INPUT_SIZE
from .lstm_model import RecallLSTM

# ──────────────────────────────────────────────────────────────────────────── #
# Model registry (singleton, lazy-loaded)
# ──────────────────────────────────────────────────────────────────────────── #

_model: Optional[RecallLSTM] = None
_model_version: str = "untrained"
_weights_dir: Path = Path(__file__).parent.parent / "weights"

DEVICE = torch.device("cpu")


def _load_model() -> tuple[RecallLSTM, str]:
    global _model, _model_version
    if _model is not None:
        return _model, _model_version

    weights_path = _weights_dir / "recall_lstm.pt"
    meta_path = _weights_dir / "model_meta.json"

    m = RecallLSTM().to(DEVICE)
    if weights_path.exists():
        m.load_state_dict(torch.load(weights_path, map_location=DEVICE))
        print(f"[inference] Loaded weights from {weights_path}")
    else:
        print(f"[inference] Weights not found at {weights_path}; using untrained model")

    version = "untrained"
    if meta_path.exists():
        with open(meta_path) as f:
            meta = json.load(f)
        version = meta.get("model_version", "untrained")

    m.eval()
    _model = m
    _model_version = version
    return _model, _model_version


# ──────────────────────────────────────────────────────────────────────────── #
# Hidden-state builder
# ──────────────────────────────────────────────────────────────────────────── #

def _build_hidden_state(
    events: list[dict],
    card_difficulty: float,
    concept_tags: list[str],
    model: RecallLSTM,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Run the LSTM over historical events to produce a hidden state."""
    seqs, _ = extract_sequence(events, card_difficulty, concept_tags)
    if not seqs:
        # Return zero hidden state
        h = torch.zeros(model.lstm.num_layers, 1, model.lstm.hidden_size, device=DEVICE)
        c = torch.zeros_like(h)
        return h, c

    x = torch.tensor(seqs, dtype=torch.float32, device=DEVICE)
    x = x.unsqueeze(0)  # (1, seq_len, INPUT_SIZE)
    with torch.no_grad():
        _, (h, c) = model(x)
    return h, c


# ──────────────────────────────────────────────────────────────────────────── #
# Candidate interval search
# ──────────────────────────────────────────────────────────────────────────── #

_MIN_INTERVAL_DAYS = 10 / 1440       # 10 minutes
_MAX_INTERVAL_DAYS = 365 * 3         # 3 years
_N_CANDIDATES = 200


def _candidate_intervals() -> list[float]:
    """Return geometrically-spaced candidate intervals (days)."""
    lo = math.log(_MIN_INTERVAL_DAYS)
    hi = math.log(_MAX_INTERVAL_DAYS)
    return [math.exp(lo + (hi - lo) * i / (_N_CANDIDATES - 1)) for i in range(_N_CANDIDATES)]


def _predict_recall_at_interval(
    interval_days: float,
    last_event: dict,
    card_difficulty: float,
    concept_tags: list[str],
    h: torch.Tensor,
    c: torch.Tensor,
    model: RecallLSTM,
) -> float:
    """
    Predict recall probability for a *hypothetical* next review at interval_days
    after the last known event.
    """
    import math as _math
    from .features import (
        _log1p_norm, _rating_onehot, _tag_hash, INPUT_SIZE,
        MAX_INTERVAL_DAYS,
    )

    log_scale = _math.log1p(MAX_INTERVAL_DAYS)
    prev_rating = float(last_event.get("rating", 3.0))
    # Approximate previous interval from last event if available
    prev_interval = float(last_event.get("_prev_interval_days", 0.0))

    feat = [
        _log1p_norm(interval_days, log_scale),
        _log1p_norm(prev_interval, log_scale),
        *_rating_onehot(prev_rating),
        _log1p_norm(float(last_event.get("_cum_successes", 0))),
        _log1p_norm(float(last_event.get("_cum_lapses", 0))),
        float(card_difficulty),
        float(_tag_hash(concept_tags)),
    ]

    x = torch.tensor([[feat]], dtype=torch.float32, device=DEVICE)  # (1, 1, INPUT_SIZE)
    with torch.no_grad():
        prob, _ = model(x, (h, c))
    return float(prob[0, 0, 0].item())


# ──────────────────────────────────────────────────────────────────────────── #
# DB helpers (loaded lazily so the module can be imported without a DB)
# ──────────────────────────────────────────────────────────────────────────── #

def _fetch_events(db_url: str, user_id: str, card_id: int, n: int = 50) -> tuple[list[dict], float, list[str]]:
    """Fetch the last n review_events + card metadata from PostgreSQL."""
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT
            re.timestamp, re.rating, re.latency_ms, re.was_hint_used,
            c.difficulty,
            co.tags
        FROM review_events re
        JOIN cards    c  ON c.id  = re.card_id
        JOIN concepts co ON co.id = c.concept_id
        WHERE re.user_id = %s AND re.card_id = %s
        ORDER BY re.timestamp DESC
        LIMIT %s
    """, (user_id, card_id, n))

    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return [], 0.5, []

    difficulty = float(rows[0]["difficulty"])
    tags = list(rows[0]["tags"] or [])

    events = [
        {
            "timestamp": row["timestamp"],
            "rating": float(row["rating"]),
            "latency_ms": row["latency_ms"],
            "was_hint_used": bool(row["was_hint_used"]),
        }
        for row in reversed(rows)  # oldest first
    ]

    # Annotate with running stats needed for single-step prediction
    cum_s = 0
    cum_l = 0
    prev_t = None
    prev_interval = 0.0
    for ev in events:
        ev["_cum_successes"] = cum_s
        ev["_cum_lapses"] = cum_l
        ev["_prev_interval_days"] = prev_interval
        if prev_t is not None:
            dt = ev["timestamp"]
            if isinstance(dt, str):
                dt = dt.replace("Z", "+00:00")
                dt = datetime.fromisoformat(dt)
            prev_dt = prev_t
            prev_interval = (dt - prev_dt).total_seconds() / 86400.0
        prev_t = ev["timestamp"]
        if ev["rating"] >= 3.0:
            cum_s += 1
        else:
            cum_l += 1

    return events, difficulty, tags


# ──────────────────────────────────────────────────────────────────────────── #
# Public API
# ──────────────────────────────────────────────────────────────────────────── #

def schedule_next_review(
    user_id: str,
    card_id: int,
    now: datetime,
    target_recall: float = 0.9,
    db_url: str | None = None,
) -> dict:
    """
    Returns
    -------
    {
        "scheduled_at"    : ISO-8601 string,
        "predicted_recall": float,
        "model_version"   : str,
    }
    """
    model, model_version = _load_model()

    if db_url:
        events, difficulty, tags = _fetch_events(db_url, user_id, card_id)
    else:
        events, difficulty, tags = [], 0.5, []

    h, c = _build_hidden_state(events, difficulty, tags, model)

    last_event = events[-1] if events else {
        "rating": 3.0,
        "_cum_successes": 0,
        "_cum_lapses": 0,
        "_prev_interval_days": 0.0,
    }

    candidates = _candidate_intervals()
    probs = [
        _predict_recall_at_interval(d, last_event, difficulty, tags, h, c, model)
        for d in candidates
    ]

    # Find interval where predicted recall is closest to target_recall
    # (probabilities decay over time, so find the crossover)
    best_days = candidates[0]
    best_diff = abs(probs[0] - target_recall)
    for d, p in zip(candidates, probs):
        diff = abs(p - target_recall)
        if diff < best_diff:
            best_diff = diff
            best_days = d

    scheduled_at = now + timedelta(days=best_days)

    # Use predicted recall at best_days
    idx = candidates.index(best_days)
    predicted_recall = float(probs[idx])

    return {
        "scheduled_at": scheduled_at.isoformat(),
        "predicted_recall": round(predicted_recall, 4),
        "model_version": model_version,
    }
