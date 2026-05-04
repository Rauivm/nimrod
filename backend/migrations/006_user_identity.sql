-- Migration 006: user identity enhancements
-- Adds display_name (independent nickname), LGPD consent fields to users.
-- Backfills display_name from existing name column so no row is left NULL.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name    TEXT,
  ADD COLUMN IF NOT EXISTS lgpd_consent    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lgpd_consent_at TIMESTAMPTZ;

-- Backfill: derive display_name from existing name for all current users.
UPDATE users
SET display_name = LOWER(SPLIT_PART(email, '@', 1))
WHERE display_name IS NULL;

-- Make display_name non-nullable now that backfill is done.
ALTER TABLE users
  ALTER COLUMN display_name SET NOT NULL;
