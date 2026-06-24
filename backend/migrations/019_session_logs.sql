-- 019_session_logs.sql
--
-- Módulo de log de sessões e rastreamento de recursos por jogador.
--
-- Objetivos:
--   1. Adicionar role GM_PRINCIPAL ao ENUM user_role existente
--   2. Criar tabela session_logs  (cabeçalho de cada sessão)
--   3. Criar tabela resource_deltas (cada evento de recurso)
--   4. Criar tabela resource_delta_audit (trilha imutável de edições)
--   5. Criar tabela session_snapshots (totais consolidados ao fechar sessão)
--   6. Triggers: updated_at, guard sessão aberta, audit automático
--   7. Views: v_session_player_totals, v_session_event_feed
--
-- Idempotência:
--   • ENUMs alterados com DO/EXCEPTION WHEN duplicate_object
--   • Tabelas com CREATE TABLE IF NOT EXISTS
--   • Índices com CREATE INDEX IF NOT EXISTS
--   • Triggers e funções com CREATE OR REPLACE
--   • Constraints verificadas via pg_constraint antes de criar

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTEND user_role ENUM → adiciona GM_PRINCIPAL
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'GM_PRINCIPAL';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. NOVOS ENUMs (guards idempotentes)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('open', 'closed', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE resource_type AS ENUM (
    'gold', 'xp', 'potion', 'spell_slot', 'item', 'hp', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delta_source AS ENUM ('foundry', 'manual', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SESSION_LOGS — cabeçalho de cada sessão de jogo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_logs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação
  title           TEXT          NOT NULL,           -- "Sessão 12 — A Taverna Maldita"
  campaign        TEXT,                             -- nome da campanha (opcional)
  session_number  INTEGER       CHECK (session_number > 0),

  -- Estado
  status          session_status NOT NULL DEFAULT 'open',
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  scheduled_at    TIMESTAMPTZ,

  -- Responsáveis
  opened_by       UUID          NOT NULL REFERENCES users(id),
  closed_by       UUID          REFERENCES users(id),
  primary_gm_id   UUID          NOT NULL REFERENCES users(id),

  -- Narradores participantes (GMs que registram nessa sessão)
  narrator_ids    UUID[]        NOT NULL DEFAULT '{}',

  -- Jogadores presentes na sessão
  player_ids      UUID[]        NOT NULL DEFAULT '{}',

  -- Notas
  summary         TEXT,         -- resumo escrito ao fechar (visível a todos)
  gm_notes        TEXT,         -- notas privadas (visível só a GMs)
  tags            TEXT[]        NOT NULL DEFAULT '{}',

  -- Vínculo Foundry
  foundry_scene_id TEXT,        -- cena ativa durante a sessão

  -- Auditoria
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT chk_closed_requires_closed_at
    CHECK (status != 'closed' OR closed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_sl_status
  ON session_logs (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sl_primary_gm
  ON session_logs (primary_gm_id);
CREATE INDEX IF NOT EXISTS idx_sl_opened_by
  ON session_logs (opened_by);
CREATE INDEX IF NOT EXISTS idx_sl_started_at
  ON session_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sl_narrator_ids
  ON session_logs USING GIN (narrator_ids);
CREATE INDEX IF NOT EXISTS idx_sl_player_ids
  ON session_logs USING GIN (player_ids);
CREATE INDEX IF NOT EXISTS idx_sl_tags
  ON session_logs USING GIN (tags);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RESOURCE_DELTAS — cada evento de recurso durante uma sessão
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resource_deltas (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vínculo com a sessão
  session_id      UUID          NOT NULL REFERENCES session_logs(id) ON DELETE RESTRICT,

  -- Jogador afetado
  player_id       UUID          NOT NULL REFERENCES users(id),
  actor_name      TEXT          NOT NULL, -- nome do personagem no momento do evento

  -- Quem registrou
  registered_by   UUID          NOT NULL REFERENCES users(id),
  source          delta_source  NOT NULL DEFAULT 'manual',

  -- O que mudou
  resource_type   resource_type NOT NULL,
  delta           NUMERIC(12,4) NOT NULL CHECK (delta != 0),
  value_before    NUMERIC(12,4),
  value_after     NUMERIC(12,4),

  -- Metadados extras em JSON livre
  -- spell_slot → { "slot_level": 3 }
  -- item       → { "item_name": "Poção de Cura", "item_id": "foundry-uuid" }
  -- custom     → { "resource_name": "Pontos de Influência" }
  delta_meta      JSONB         NOT NULL DEFAULT '{}',

  -- Descrição humana do evento
  description     TEXT,

  -- ID do evento no Foundry (para idempotência — evita duplicatas)
  foundry_event_id TEXT         UNIQUE,

  -- Quando o evento ocorreu de fato (pode ser retroativo)
  occurred_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Auditoria
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Edição retroativa (somente GM_PRINCIPAL)
  edited_at       TIMESTAMPTZ,
  edited_by       UUID          REFERENCES users(id),
  edit_reason     TEXT,

  -- Soft delete (cancela o delta sem perder histórico)
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID          REFERENCES users(id),
  delete_reason   TEXT,

  CONSTRAINT chk_edit_requires_reason
    CHECK (edited_at IS NULL OR (edit_reason IS NOT NULL AND edited_by IS NOT NULL)),

  CONSTRAINT chk_delete_requires_reason
    CHECK (deleted_at IS NULL OR (delete_reason IS NOT NULL AND deleted_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_rd_session_id
  ON resource_deltas (session_id);
CREATE INDEX IF NOT EXISTS idx_rd_player_id
  ON resource_deltas (player_id);
CREATE INDEX IF NOT EXISTS idx_rd_session_player
  ON resource_deltas (session_id, player_id);
CREATE INDEX IF NOT EXISTS idx_rd_resource_type
  ON resource_deltas (resource_type);
CREATE INDEX IF NOT EXISTS idx_rd_source
  ON resource_deltas (source);
CREATE INDEX IF NOT EXISTS idx_rd_occurred_at
  ON resource_deltas (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_rd_active
  ON resource_deltas (session_id, player_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rd_delta_meta
  ON resource_deltas USING GIN (delta_meta);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RESOURCE_DELTA_AUDIT — trilha imutável (append-only)
--    Gravada automaticamente pelo trigger trg_rd_audit (seção 7c)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resource_delta_audit (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  delta_id        UUID          NOT NULL REFERENCES resource_deltas(id) ON DELETE RESTRICT,
  audited_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  audited_by      UUID          NOT NULL REFERENCES users(id),
  action          TEXT          NOT NULL CHECK (action IN ('edit', 'delete')),

  -- Snapshot do estado anterior
  prev_delta          NUMERIC(12,4),
  prev_value_before   NUMERIC(12,4),
  prev_value_after    NUMERIC(12,4),
  prev_delta_meta     JSONB,
  prev_description    TEXT,
  prev_occurred_at    TIMESTAMPTZ,
  reason              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rda_delta_id
  ON resource_delta_audit (delta_id);
CREATE INDEX IF NOT EXISTS idx_rda_audited_at
  ON resource_delta_audit (audited_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SESSION_SNAPSHOTS — totais consolidados ao fechar a sessão
--    Calculado pelo backend ao chamar POST /api/sessions/:id/close
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_snapshots (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID          NOT NULL REFERENCES session_logs(id) ON DELETE RESTRICT,
  player_id           UUID          NOT NULL REFERENCES users(id),
  actor_name          TEXT          NOT NULL,

  -- Totais consolidados da sessão
  total_gold_delta    NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_xp_delta      NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_hp_delta      NUMERIC(12,4) NOT NULL DEFAULT 0,
  spell_slots_spent   JSONB         NOT NULL DEFAULT '{}',  -- { "1": 2, "3": 1 }
  potions_used        INTEGER       NOT NULL DEFAULT 0,
  items_summary       JSONB         NOT NULL DEFAULT '[]',  -- [{ item_name, qty_delta }]
  custom_resources    JSONB         NOT NULL DEFAULT '{}',  -- { resource_name: total_delta }

  computed_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (session_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_ss_session_id ON session_snapshots (session_id);
CREATE INDEX IF NOT EXISTS idx_ss_player_id  ON session_snapshots (player_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- 7a. updated_at automático
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sl_updated_at ON session_logs;
CREATE TRIGGER trg_sl_updated_at
  BEFORE UPDATE ON session_logs
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_rd_updated_at ON resource_deltas;
CREATE TRIGGER trg_rd_updated_at
  BEFORE UPDATE ON resource_deltas
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 7b. Bloqueia inserção de delta em sessão não-aberta
CREATE OR REPLACE FUNCTION fn_guard_session_open()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status session_status;
BEGIN
  SELECT status INTO v_status
    FROM session_logs
   WHERE id = NEW.session_id;

  IF v_status != 'open' THEN
    RAISE EXCEPTION 'session_not_open: sessão % está com status "%" e não aceita novos eventos.',
      NEW.session_id, v_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rd_guard_session_open ON resource_deltas;
CREATE TRIGGER trg_rd_guard_session_open
  BEFORE INSERT ON resource_deltas
  FOR EACH ROW EXECUTE FUNCTION fn_guard_session_open();

-- 7c. Audit trail automático ao editar ou deletar um delta
CREATE OR REPLACE FUNCTION fn_audit_resource_delta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
    OLD.delta          IS DISTINCT FROM NEW.delta       OR
    OLD.value_before   IS DISTINCT FROM NEW.value_before OR
    OLD.value_after    IS DISTINCT FROM NEW.value_after  OR
    OLD.delta_meta     IS DISTINCT FROM NEW.delta_meta   OR
    OLD.description    IS DISTINCT FROM NEW.description  OR
    OLD.occurred_at    IS DISTINCT FROM NEW.occurred_at  OR
    OLD.deleted_at     IS DISTINCT FROM NEW.deleted_at
  ) THEN
    INSERT INTO resource_delta_audit (
      delta_id, audited_by, action,
      prev_delta, prev_value_before, prev_value_after,
      prev_delta_meta, prev_description, prev_occurred_at,
      reason
    ) VALUES (
      OLD.id,
      COALESCE(NEW.edited_by, NEW.deleted_by),
      CASE
        WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete'
        ELSE 'edit'
      END,
      OLD.delta, OLD.value_before, OLD.value_after,
      OLD.delta_meta, OLD.description, OLD.occurred_at,
      COALESCE(NEW.edit_reason, NEW.delete_reason, '(sem motivo registrado)')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rd_audit ON resource_deltas;
CREATE TRIGGER trg_rd_audit
  AFTER UPDATE ON resource_deltas
  FOR EACH ROW EXECUTE FUNCTION fn_audit_resource_delta();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- 8a. Totais por jogador por sessão (para o painel de resumo)
CREATE OR REPLACE VIEW v_session_player_totals AS
SELECT
  rd.session_id,
  sl.title                                   AS session_title,
  sl.status                                  AS session_status,
  sl.started_at,
  sl.closed_at,
  rd.player_id,
  COALESCE(u.display_name, u.name)           AS player_name,
  rd.actor_name,
  rd.resource_type,
  SUM(rd.delta)                              AS total_delta,
  COUNT(*)                                   AS event_count,
  MIN(rd.occurred_at)                        AS first_event,
  MAX(rd.occurred_at)                        AS last_event
FROM resource_deltas AS rd
INNER JOIN session_logs AS sl ON sl.id = rd.session_id
INNER JOIN users AS u         ON u.id  = rd.player_id
WHERE rd.deleted_at IS NULL
  AND sl.deleted_at IS NULL
GROUP BY
  rd.session_id, sl.title, sl.status, sl.started_at, sl.closed_at,
  rd.player_id, u.display_name, u.name, rd.actor_name, rd.resource_type;

-- 8b. Feed de eventos de uma sessão (para o log viewer em tempo real)
CREATE OR REPLACE VIEW v_session_event_feed AS
SELECT
  rd.id,
  rd.session_id,
  rd.occurred_at,
  rd.source,
  rd.resource_type,
  rd.delta,
  rd.value_before,
  rd.value_after,
  rd.description,
  rd.delta_meta,
  rd.edited_at,
  rd.deleted_at,
  rd.player_id,
  COALESCE(pu.display_name, pu.name)         AS player_name,
  rd.actor_name,
  rd.registered_by,
  COALESCE(ru.display_name, ru.name)         AS registered_by_name,
  ru.role                                    AS registered_by_role
FROM resource_deltas AS rd
INNER JOIN users AS pu ON pu.id = rd.player_id
INNER JOIN users AS ru ON ru.id = rd.registered_by
ORDER BY rd.occurred_at DESC;

COMMIT;
