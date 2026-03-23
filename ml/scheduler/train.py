"""
Training pipeline for the LSTM recall scheduler.

Usage
-----
    python -m ml.scheduler.train \
        --db-url postgresql://user:pass@host/db \
        --output-dir ml/weights

The pipeline:
  1. Loads all review_events (+ card difficulty, concept tags) from PostgreSQL.
  2. Groups by (user_id, card_id), sorts by timestamp.
  3. Extracts feature sequences via ml.scheduler.features.extract_sequence.
  4. Splits data by time (TimeSeriesSplit on last-event date).
  5. Trains RecallLSTM with BCELoss.
  6. Reports log-loss and calibration RMSE per recall bucket.
  7. Saves model weights and a JSON feature-normaliser metadata file.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

from .features import extract_sequence, INPUT_SIZE
from .lstm_model import RecallLSTM

# ──────────────────────────────────────────────────────────────────────────── #
# Data loading
# ──────────────────────────────────────────────────────────────────────────── #

def load_data_from_db(db_url: str):
    """
    Returns a list of dicts:
      [
        {
          'user_id': str,
          'card_id': int,
          'difficulty': float,
          'tags': ['tag1', 'tag2'],
          'events': [
            {'timestamp': datetime, 'rating': float, 'latency_ms': int, 'was_hint_used': bool},
          ],
        },
      ]
    """
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT
            re.user_id,
            re.card_id,
            re.timestamp,
            re.rating,
            re.latency_ms,
            re.was_hint_used,
            c.difficulty,
            co.tags
        FROM review_events re
        JOIN cards    c  ON c.id  = re.card_id
        JOIN concepts co ON co.id = c.concept_id
        ORDER BY re.user_id, re.card_id, re.timestamp
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    # Group rows
    grouped: dict[tuple, dict] = {}
    for row in rows:
        key = (row["user_id"], row["card_id"])
        if key not in grouped:
            grouped[key] = {
                "user_id": row["user_id"],
                "card_id": row["card_id"],
                "difficulty": float(row["difficulty"]),
                "tags": list(row["tags"] or []),
                "events": [],
            }
        grouped[key]["events"].append({
            "timestamp": row["timestamp"],
            "rating": float(row["rating"]),
            "latency_ms": row["latency_ms"],
            "was_hint_used": bool(row["was_hint_used"]),
        })

    return list(grouped.values())


# ──────────────────────────────────────────────────────────────────────────── #
# Dataset
# ──────────────────────────────────────────────────────────────────────────── #

class ReviewDataset(Dataset):
    """Flattened (feature_vec, label) pairs from all sequences."""

    def __init__(self, records):
        xs, ys = [], []
        for rec in records:
            seqs, labels = extract_sequence(
                rec["events"],
                card_difficulty=rec["difficulty"],
                concept_tags=rec["tags"],
            )
            xs.extend(seqs)
            ys.extend(labels)
        self.X = torch.tensor(xs, dtype=torch.float32)
        self.y = torch.tensor(ys, dtype=torch.float32)

    def __len__(self):
        return len(self.y)

    def __getitem__(self, idx):
        return self.X[idx].unsqueeze(0), self.y[idx]  # (1, INPUT_SIZE), scalar


# ──────────────────────────────────────────────────────────────────────────── #
# Metrics
# ──────────────────────────────────────────────────────────────────────────── #

def _log_loss(probs: np.ndarray, labels: np.ndarray, eps: float = 1e-7) -> float:
    p = np.clip(probs, eps, 1 - eps)
    return float(-np.mean(labels * np.log(p) + (1 - labels) * np.log(1 - p)))


def _rmse_bins(probs: np.ndarray, labels: np.ndarray, n_bins: int = 10) -> float:
    bins = np.linspace(0, 1, n_bins + 1)
    se = 0.0
    count = 0
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (probs >= lo) & (probs < hi)
        if mask.sum() == 0:
            continue
        p_mean = probs[mask].mean()
        actual = labels[mask].mean()
        se += (p_mean - actual) ** 2
        count += 1
    return float(math.sqrt(se / max(count, 1)))


# ──────────────────────────────────────────────────────────────────────────── #
# Train / evaluate
# ──────────────────────────────────────────────────────────────────────────── #

def train(
    records,
    output_dir: str | Path,
    epochs: int = 10,
    batch_size: int = 256,
    lr: float = 1e-3,
    n_splits: int = 3,
    seed: int = 42,
):
    random.seed(seed)
    torch.manual_seed(seed)
    np.random.seed(seed)

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Time-based split: sort records by last-event timestamp, use last fold as val
    records_sorted = sorted(
        records,
        key=lambda r: max(e["timestamp"] for e in r["events"]),
    )
    split_pt = int(len(records_sorted) * (1 - 1 / n_splits))
    train_records = records_sorted[:split_pt]
    val_records = records_sorted[split_pt:]

    print(f"Train sequences: {len(train_records)} | Val sequences: {len(val_records)}")

    train_ds = ReviewDataset(train_records)
    val_ds = ReviewDataset(val_records)

    if len(train_ds) == 0:
        print("No training data available. Saving untrained model.")
        model = RecallLSTM()
        _save(model, output_dir)
        return model

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = RecallLSTM().to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCELoss()

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for X_batch, y_batch in train_loader:
            X_batch = X_batch.to(device)          # (B, 1, INPUT_SIZE)
            y_batch = y_batch.to(device)           # (B,)
            optimiser.zero_grad()
            probs, _ = model(X_batch)              # (B, 1, 1)
            probs = probs.squeeze(-1).squeeze(-1)  # (B,)
            loss = criterion(probs, y_batch)
            loss.backward()
            optimiser.step()
            total_loss += loss.item() * len(y_batch)

        avg_loss = total_loss / len(train_ds)
        print(f"Epoch {epoch}/{epochs}  train_bce={avg_loss:.4f}")

    # Evaluate on validation set
    if len(val_ds) > 0:
        model.eval()
        all_probs, all_labels = [], []
        with torch.no_grad():
            for X_batch, y_batch in DataLoader(val_ds, batch_size=512):
                p, _ = model(X_batch.to(device))
                all_probs.extend(p.squeeze(-1).squeeze(-1).cpu().numpy().tolist())
                all_labels.extend(y_batch.numpy().tolist())
        p_arr = np.array(all_probs)
        y_arr = np.array(all_labels)
        print(f"Val log-loss: {_log_loss(p_arr, y_arr):.4f}  "
              f"RMSE(bins): {_rmse_bins(p_arr, y_arr):.4f}")

    _save(model, output_dir)
    return model


def _save(model: RecallLSTM, output_dir: Path):
    weights_path = output_dir / "recall_lstm.pt"
    torch.save(model.state_dict(), weights_path)
    meta = {
        "model_version": "1.0",
        "input_size": INPUT_SIZE,
        "hidden_size": 64,
        "num_layers": 2,
    }
    with open(output_dir / "model_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Model saved to {weights_path}")


# ──────────────────────────────────────────────────────────────────────────── #
# CLI entry-point
# ──────────────────────────────────────────────────────────────────────────── #

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train LSTM recall scheduler")
    parser.add_argument("--db-url", required=True, help="PostgreSQL connection string")
    parser.add_argument("--output-dir", default="ml/weights", help="Directory to save weights")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    records = load_data_from_db(args.db_url)
    print(f"Loaded {len(records)} (user, card) sequences from DB")
    train(records, args.output_dir, epochs=args.epochs, batch_size=args.batch_size, lr=args.lr)
