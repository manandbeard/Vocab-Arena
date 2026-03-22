"""
FastAPI HTTP service exposing the LSTM scheduler.

Start with:
    uvicorn ml.app:app --host 0.0.0.0 --port 8001

Endpoints
---------
  GET  /health
  POST /schedule-next-review
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .scheduler.inference import schedule_next_review

app = FastAPI(title="Vocab-Arena ML Service", version="1.0.0")

DB_URL = os.getenv("DATABASE_URL", "")


# ──────────────────────────────────────────────────────────────────────────── #
# Schemas
# ──────────────────────────────────────────────────────────────────────────── #

class ScheduleRequest(BaseModel):
    user_id: str
    card_id: int
    now: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    target_recall: float = Field(default=0.9, ge=0.0, le=1.0)


class ScheduleResponse(BaseModel):
    scheduled_at: str
    predicted_recall: float
    model_version: str


# ──────────────────────────────────────────────────────────────────────────── #
# Routes
# ──────────────────────────────────────────────────────────────────────────── #

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/schedule-next-review", response_model=ScheduleResponse)
def schedule(req: ScheduleRequest):
    try:
        result = schedule_next_review(
            user_id=req.user_id,
            card_id=req.card_id,
            now=req.now,
            target_recall=req.target_recall,
            db_url=DB_URL or None,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
