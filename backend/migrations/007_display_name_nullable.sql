-- Migration 007: display_name post-consent flow
-- display_name column was added in 006.
-- This migration is a no-op guard to ensure the column is truly nullable
-- before the post-consent assignment step (NULL = not yet chosen).
--
-- After LGPD consent the frontend calls POST /me/display-name.
-- Until that endpoint is called, display_name is NULL (or the derived
-- email-prefix value set in 006). We allow NULL again so the frontend
-- flow can detect "not yet set".

-- Re-allow NULL so freshly-created users (after 006 ran) can have
-- display_name = NULL until they complete the post-consent modal.
ALTER TABLE users
  ALTER COLUMN display_name DROP NOT NULL;

-- Existing rows already have display_name populated from the 006 backfill,
-- so they will NOT be shown the modal. Only rows inserted after this
-- migration with display_name IS NULL will trigger it.
