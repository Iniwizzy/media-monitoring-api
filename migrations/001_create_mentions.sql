-- Migration: 001_create_mentions
-- Creates the mentions table with all required indexes.

CREATE TABLE IF NOT EXISTS mentions (
  id           SERIAL PRIMARY KEY,
  external_id  TEXT        NOT NULL,
  source       TEXT        NOT NULL,
  title        TEXT,
  content      TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  author       TEXT,
  published_at TIMESTAMPTZ,
  engagement   INTEGER     NOT NULL DEFAULT 0
);

-- Unique constraint on external_id (idempotency via UPSERT)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_mentions_external_id
  ON mentions (external_id);

-- Index for source filtering / stats grouping
CREATE INDEX IF NOT EXISTS idx_mentions_source
  ON mentions (source);

-- Index for date-range queries and stats grouping by day
CREATE INDEX IF NOT EXISTS idx_mentions_published_at
  ON mentions (published_at);

-- GIN index for full-text search on title + content
ALTER TABLE mentions
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_mentions_search_vector
  ON mentions USING GIN (search_vector);
