-- Migration 004: remove meeting_location from missions
-- meeting_location has been removed from the application entirely.
-- This migration drops the column if it still exists.

ALTER TABLE missions DROP COLUMN IF EXISTS meeting_location;
