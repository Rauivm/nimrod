-- Separate file: PostgreSQL enum values must commit before being used.
ALTER TYPE mission_status ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE mission_status ADD VALUE IF NOT EXISTS 'CANCELLED';
