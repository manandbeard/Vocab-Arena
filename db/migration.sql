-- Migration: Add spaced-repetition learning engine tables
-- Run this after the existing init-db.ts schema is applied.

-- Concepts: higher-level knowledge units that group cards
CREATE TABLE IF NOT EXISTS concepts (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  key_points  TEXT[]       NOT NULL DEFAULT '{}',
  tags        TEXT[]       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cards: individual prompts tied to a concept
CREATE TABLE IF NOT EXISTS cards (
  id          SERIAL PRIMARY KEY,
  concept_id  INTEGER      NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  base_prompt TEXT         NOT NULL,
  answer      TEXT         NOT NULL,
  format      VARCHAR(50)  NOT NULL DEFAULT 'qa'
                           CHECK (format IN ('cloze','qa','mcq','feynman','example')),
  difficulty  REAL         NOT NULL DEFAULT 0.5
                           CHECK (difficulty BETWEEN 0 AND 1),
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cards_concept_id ON cards(concept_id);

-- Review events: every time a user reviews a card
CREATE TABLE IF NOT EXISTS review_events (
  id            SERIAL    PRIMARY KEY,
  user_id       TEXT      NOT NULL,   -- Firebase UID (string)
  card_id       INTEGER   NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  session_id    TEXT,                 -- nullable; links to blurting_session.id for synthetic rows
  timestamp     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rating        REAL      NOT NULL CHECK (rating BETWEEN 0 AND 5),
  latency_ms    INTEGER,
  was_hint_used BOOLEAN   NOT NULL DEFAULT FALSE,
  is_synthetic  BOOLEAN   NOT NULL DEFAULT FALSE  -- TRUE for blurting-derived events
);

CREATE INDEX IF NOT EXISTS idx_review_events_user_card ON review_events(user_id, card_id);
CREATE INDEX IF NOT EXISTS idx_review_events_timestamp  ON review_events(timestamp);

-- Blurting sessions: free-text recall scored by LLM
CREATE TABLE IF NOT EXISTS blurting_sessions (
  id            TEXT      PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id       TEXT      NOT NULL,
  concept_id    INTEGER   NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  prompt        TEXT      NOT NULL,
  response_text TEXT      NOT NULL,
  timestamp     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scores        JSONB     NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_blurting_sessions_user_concept
  ON blurting_sessions(user_id, concept_id);
