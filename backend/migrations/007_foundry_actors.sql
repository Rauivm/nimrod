-- migrations/007_foundry_actors.sql

CREATE TABLE IF NOT EXISTS foundry_actors (
  id           BIGSERIAL    PRIMARY KEY,
  foundry_id   TEXT         NOT NULL UNIQUE,   -- Foundry actor UUID
  name         TEXT         NOT NULL,
  img          TEXT,                           -- portrait URL
  token_img    TEXT,                           -- token URL
  level        SMALLINT     NOT NULL DEFAULT 1,
  xp           INT          NOT NULL DEFAULT 0,
  xp_next      INT          NOT NULL DEFAULT 300,
  classe       TEXT,
  race         TEXT,
  biography    TEXT,
  is_dead      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_retired   BOOLEAN      NOT NULL DEFAULT FALSE,
  modified_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  synced_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ON foundry_actors (modified_at DESC);

-- Auto-update synced_at on every upsert
CREATE OR REPLACE FUNCTION set_synced_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.synced_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER foundry_actors_synced_at
  BEFORE INSERT OR UPDATE ON foundry_actors
  FOR EACH ROW EXECUTE FUNCTION set_synced_at();