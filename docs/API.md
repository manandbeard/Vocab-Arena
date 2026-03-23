# Vocab-Arena Learning Engine — API Reference

## Overview

The learning engine adds five endpoints to the existing Vocab-Arena backend:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/schedule-next-review` | LSTM-based next-review scheduler |
| `POST` | `/api/plan-session` | Build an interleaved study session |
| `POST` | `/api/render-item` | Render a single card with a specific prompt variant |
| `POST` | `/api/blurting-prompt` | Get a free-recall prompt for a concept |
| `POST` | `/api/submit-blurt` | Submit and score a free-recall response |

All endpoints require the `X-Auth-Token` header (Firebase ID token or the
developer-mode bypass token `dev-token-nbend-2026`).

---

## POST /api/schedule-next-review

Schedule the next review for a specific card using the LSTM recall model.

### Request body

```json
{
  "user_id":       "string  — Firebase UID",
  "card_id":       "integer — PostgreSQL card ID",
  "now":           "string? — ISO-8601 datetime (defaults to server time)",
  "target_recall": "number? — desired recall probability, 0–1 (default 0.9)"
}
```

### Response

```json
{
  "scheduled_at":    "2026-03-25T09:30:00.000Z",
  "predicted_recall": 0.9012,
  "model_version":   "1.0"
}
```

### Notes
- The endpoint first tries the Python ML service (`ML_SERVICE_URL`, default
  `http://localhost:8001`).  If the service is unavailable it falls back to a
  simple interval-doubling heuristic and returns `"model_version": "heuristic"`.

### Sample payload
See [`tests/fixtures/schedule_next_review.json`](../tests/fixtures/schedule_next_review.json).

---

## POST /api/plan-session

Build a study session of due and near-due cards, interleaved across concepts.

### Request body

```json
{
  "user_id":              "string  — Firebase UID",
  "desired_count":        "integer? — target number of items (1–100, default 20)",
  "optional_concept_ids": "integer[]? — restrict to specific concept IDs"
}
```

### Response

```json
{
  "session_id": "uuid-string",
  "items": [
    {
      "card_id":                "integer",
      "concept_id":             "integer",
      "planned_prompt_variant": "cloze | qa | mcq | feynman | example"
    }
  ]
}
```

### Interleaving guarantee
No two consecutive items share the same `concept_id` whenever the pool contains
enough variety.  The planner uses a greedy swap to enforce this invariant.

### Sample payload
See [`tests/fixtures/plan_session.json`](../tests/fixtures/plan_session.json).

---

## POST /api/render-item

Render a `PlannedItem` into a displayable prompt.

### Request body

```json
{
  "user_id": "string — Firebase UID",
  "session_id": "string? — from /api/plan-session response",
  "planned_item": {
    "card_id":                "integer",
    "concept_id":             "integer",
    "planned_prompt_variant": "cloze | qa | mcq | feynman | example"
  }
}
```

### Response (text-input)

```json
{
  "session_id":  "uuid-string",
  "item_id":     "uuid-string",
  "display_type": "text-input",
  "prompt_text":  "The process by which plants convert sunlight into ___ is called photosynthesis."
}
```

### Response (mcq)

```json
{
  "session_id":          "uuid-string",
  "item_id":             "uuid-string",
  "display_type":        "mcq",
  "prompt_text":         "What is the primary function of mitochondria?",
  "answer_choices":      ["Protein synthesis", "Energy production (ATP)", "DNA replication", "Cell signalling"],
  "correct_answer_index": 1
}
```

### Response (short-explain / feynman)

```json
{
  "session_id":   "uuid-string",
  "item_id":      "uuid-string",
  "display_type": "short-explain",
  "prompt_text":  "Explain the concept \"Mitosis\" in your own words to a 9th grader. Be specific and use an example."
}
```

### `display_type` mapping

| `planned_prompt_variant` | `display_type` |
|--------------------------|----------------|
| `cloze`                  | `text-input`   |
| `qa`                     | `text-input`   |
| `mcq`                    | `mcq`          |
| `feynman`                | `short-explain`|
| `example`                | `example`      |

### MCQ distractor generation
If a Gemini API key is configured (`GEMINI_API_KEY`), distractors are generated
by the model.  Otherwise, three random answers from other cards are used.

### Sample payloads
See [`tests/fixtures/render_item.json`](../tests/fixtures/render_item.json).

---

## POST /api/blurting-prompt

Get the free-recall prompt for a concept.

### Request body

```json
{
  "user_id":    "string  — Firebase UID",
  "concept_id": "integer — PostgreSQL concept ID"
}
```

### Response

```json
{
  "prompt_text": "Without looking at your notes, write everything you know about \"Mitosis\". Include definitions, examples, key points, and any connections to other concepts you can think of."
}
```

---

## POST /api/submit-blurt

Submit a free-recall response, score it with an LLM rubric, persist the session,
and create synthetic review events for all cards in the concept.

### Request body

```json
{
  "user_id":       "string  — Firebase UID",
  "concept_id":    "integer — PostgreSQL concept ID",
  "response_text": "string  — student's free-text recall"
}
```

### Response

```json
{
  "scores": {
    "coverage":           0.87,
    "accuracy":           0.92,
    "organization":       0.78,
    "overall":            0.86,
    "missing_key_points": ["Cytokinesis", "Role of centromeres"]
  },
  "feedback_text": "Excellent recall of the four main phases..."
}
```

### Score fields

| Field | Range | Meaning |
|-------|-------|---------|
| `coverage` | 0–1 | Fraction of `concept.key_points` addressed |
| `accuracy` | 0–1 | Factual correctness |
| `organization` | 0–1 | Clarity and logical structure |
| `overall` | 0–1 | Weighted holistic score |
| `missing_key_points` | string[] | Key points the student omitted or got wrong |

### Synthetic review events
After scoring, the endpoint inserts one `review_events` row (with
`is_synthetic = TRUE`) per card belonging to the concept.  The `rating` is
computed as `overall × 5` (mapped to the 0–5 scale), so high blurting scores
produce high-rated synthetic reviews that extend future card intervals.

### Fallback scoring
If the Gemini API is unavailable, a length-based heuristic is used:
`overall ≈ min(1, word_count / 100)`.

### Sample payloads
See [`tests/fixtures/submit_blurt.json`](../tests/fixtures/submit_blurt.json).

---

## Data model

### `concepts`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `title` | VARCHAR(255) | |
| `description` | TEXT | |
| `key_points` | TEXT[] | Rubric items for blurting scoring |
| `tags` | TEXT[] | Used as LSTM input feature |

### `cards`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `concept_id` | INTEGER FK→concepts | |
| `base_prompt` | TEXT | Default prompt text |
| `answer` | TEXT | Correct answer |
| `format` | VARCHAR(50) | `cloze \| qa \| mcq \| feynman \| example` |
| `difficulty` | REAL (0–1) | LSTM input feature |

### `review_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `user_id` | TEXT | Firebase UID |
| `card_id` | INTEGER FK→cards | |
| `session_id` | TEXT | Links to `blurting_sessions.id` for synthetic rows |
| `timestamp` | TIMESTAMP | |
| `rating` | REAL (0–5) | |
| `latency_ms` | INTEGER | |
| `was_hint_used` | BOOLEAN | |
| `is_synthetic` | BOOLEAN | TRUE for blurting-derived events |

### `blurting_sessions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT | Firebase UID |
| `concept_id` | INTEGER FK→concepts | |
| `prompt` | TEXT | |
| `response_text` | TEXT | Student's raw recall |
| `timestamp` | TIMESTAMP | |
| `scores` | JSONB | Blurting score object |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `GEMINI_API_KEY` | — | Google Gemini API key for MCQ/blurting scoring |
| `ML_SERVICE_URL` | `http://localhost:8001` | URL of the Python LSTM service |

---

## Running the ML service

```bash
cd ml
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

To train the model:

```bash
python -m ml.scheduler.train \
  --db-url postgresql://user:pass@host/db \
  --output-dir ml/weights \
  --epochs 20
```

## Running the tests

```bash
cd /path/to/repo
pip install -r ml/requirements.txt
pytest ml/tests/ -v
```
