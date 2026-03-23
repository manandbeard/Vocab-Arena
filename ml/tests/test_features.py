"""
Unit tests for feature extraction from review_events into LSTM sequences.
"""
import math
import sys
import os
from datetime import datetime, timedelta, timezone

# Allow imports from the repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.scheduler.features import (
    extract_sequence,
    INPUT_SIZE,
    _log1p_norm,
    _rating_onehot,
    _tag_hash,
)


# ─────────────────────────────────────────────── helpers ── #

def make_events(ratings, base_dt=None, interval_days=1.0):
    """Build a list of review_event dicts with the given ratings."""
    if base_dt is None:
        base_dt = datetime(2024, 1, 1, tzinfo=timezone.utc)
    events = []
    for i, r in enumerate(ratings):
        events.append({
            "timestamp": (base_dt + timedelta(days=i * interval_days)).isoformat(),
            "rating": r,
            "latency_ms": 1500,
            "was_hint_used": False,
        })
    return events


# ─────────────────────────────────────────────── unit tests ── #

class TestLogNorm:
    def test_zero_input(self):
        assert _log1p_norm(0.0) == 0.0

    def test_positive_input(self):
        val = _log1p_norm(1.0)
        assert abs(val - math.log1p(1.0)) < 1e-9

    def test_negative_clamped(self):
        # Negative values should be clamped to 0
        assert _log1p_norm(-5.0) == 0.0


class TestRatingOnehot:
    def test_shape(self):
        for r in [0, 1, 2, 3, 4]:
            v = _rating_onehot(float(r))
            assert len(v) == 5
            assert sum(v) == 1.0
            assert v[r] == 1.0

    def test_clamp_high(self):
        v = _rating_onehot(5.0)
        assert v[4] == 1.0

    def test_clamp_low(self):
        v = _rating_onehot(-1.0)
        assert v[0] == 1.0


class TestTagHash:
    def test_empty_tags(self):
        assert _tag_hash([]) == 0.0

    def test_range(self):
        h = _tag_hash(["math", "algebra"])
        assert 0.0 <= h <= 1.0

    def test_deterministic(self):
        assert _tag_hash(["vocab"]) == _tag_hash(["vocab"])

    def test_different_tags_differ(self):
        assert _tag_hash(["a"]) != _tag_hash(["b"])


class TestExtractSequence:
    def test_empty_events(self):
        seqs, labels = extract_sequence([])
        assert seqs == []
        assert labels == []

    def test_single_event_no_label(self):
        seqs, labels = extract_sequence(make_events([3]))
        # 1 event → 0 (feat, label) pairs (need at least 2 events for a label)
        assert len(seqs) == 0
        assert len(labels) == 0

    def test_two_events_one_pair(self):
        seqs, labels = extract_sequence(make_events([3, 4]))
        assert len(seqs) == 1
        assert len(labels) == 1

    def test_correct_input_size(self):
        seqs, labels = extract_sequence(make_events([2, 3, 4]))
        for s in seqs:
            assert len(s) == INPUT_SIZE

    def test_label_success(self):
        # Rating 4 at next step → label 1
        seqs, labels = extract_sequence(make_events([3, 4]))
        assert labels[0] == 1

    def test_label_failure(self):
        # Rating 1 at next step → label 0
        seqs, labels = extract_sequence(make_events([3, 1]))
        assert labels[0] == 0

    def test_cumulative_counts_increase(self):
        # After 3 successes, feature 7 (cum_successes normalised) should grow
        events = make_events([4, 4, 4, 4])
        seqs, _ = extract_sequence(events)
        cum_success_vals = [s[7] for s in seqs]
        for i in range(len(cum_success_vals) - 1):
            assert cum_success_vals[i] <= cum_success_vals[i + 1]

    def test_time_feature_increases_with_gap(self):
        # Larger gaps → larger time_since_last_review feature (index 0)
        # Use 3 events so seqs[1] captures the gap between events 0→1
        small_gap = make_events([3, 4, 3], interval_days=1)
        large_gap = make_events([3, 4, 3], interval_days=30)
        seqs_small, _ = extract_sequence(small_gap)
        seqs_large, _ = extract_sequence(large_gap)
        # seqs[1] is extracted at event index 1, time_since = gap from event 0 to event 1
        assert seqs_large[1][0] > seqs_small[1][0]

    def test_difficulty_propagated(self):
        seqs, _ = extract_sequence(make_events([3, 4]), card_difficulty=0.8)
        assert abs(seqs[0][9] - 0.8) < 1e-6

    def test_all_features_finite(self):
        seqs, labels = extract_sequence(
            make_events([1, 2, 3, 4, 3, 2]),
            card_difficulty=0.5,
            concept_tags=["grammar", "vocab"],
        )
        for s in seqs:
            for v in s:
                assert math.isfinite(v), f"Non-finite feature value: {v}"

    def test_n_sequences_matches_n_events_minus_one(self):
        n = 7
        seqs, labels = extract_sequence(make_events(list(range(n))))
        assert len(seqs) == n - 1
        assert len(labels) == n - 1
