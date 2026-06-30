-- Migration 023: poll deadline (closes_at)
-- Adds optional closes_at to polls so creators can set a voting deadline.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_polls_closes_at ON polls (closes_at)
  WHERE closes_at IS NOT NULL;
