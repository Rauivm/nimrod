-- 021_arcs_and_mission_session_links.sql
--
-- Modelo definitivo Nimrod: Missão → Arco → Sessão → Eventos
--
-- Hierarquia:
--   Mission (quadro de avisos, sign-up de jogadores)
--     └── Arc    (trecho narrativo com início/fim definidos)
--           └── Session (sessão de jogo — gera ResourceDeltas)
--
-- Regras de negócio:
--   • Um personagem não pode participar de dois Arcos ativos ao mesmo tempo
--   • Recompensas (XP, gold) são distribuídas ao fechar o Arco, não a Sessão
--   • Eventos registrados após o fechamento de uma Sessão são marcados
--     como out_of_session = TRUE e continuam auditáveis
--   • O Bridge nunca perde sincronização — eventos fora de sessão são aceitos
--
-- Idempotência: CREATE IF NOT EXISTS, ALTER ... IF NOT EXISTS, DO/EXCEPTION blocks

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENUMs novos
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE arc_status AS ENUM ('active', 'closed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MISSION_ARCS — trecho narrativo dentro de uma missão
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mission_arcs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID          NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,

  -- Identificação
  title           TEXT          NOT NULL,
  arc_number      INTEGER       NOT NULL DEFAULT 1 CHECK (arc_number > 0),
  description     TEXT,

  -- Estado
  status          arc_status    NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,

  -- GM responsável pelo arco
  primary_gm_id   UUID          NOT NULL REFERENCES users(id),
  closed_by       UUID          REFERENCES users(id),

  -- Recompensas definidas ao fechar o arco (calculadas pelo GM ou automaticamente)
  reward_xp       NUMERIC(12,4) NOT NULL DEFAULT 0,
  reward_gold     NUMERIC(12,4) NOT NULL DEFAULT 0,
  reward_notes    TEXT,
  rewards_distributed BOOLEAN   NOT NULL DEFAULT FALSE,
  rewards_distributed_at TIMESTAMPTZ,

  -- Auditoria
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT chk_arc_closed_requires_closed_at
    CHECK (status != 'closed' OR closed_at IS NOT NULL),
  CONSTRAINT uq_arc_number_per_mission
    UNIQUE (mission_id, arc_number)
);

CREATE INDEX IF NOT EXISTS idx_arc_mission_id
  ON mission_arcs (mission_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arc_status
  ON mission_arcs (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arc_primary_gm
  ON mission_arcs (primary_gm_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ARC_PARTICIPANTS — personagens vinculados a um arco
--    (exclusividade: um personagem não pode estar em dois arcos ativos)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arc_participants (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_id          UUID          NOT NULL REFERENCES mission_arcs(id) ON DELETE RESTRICT,
  mission_id      UUID          NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  character_id    UUID          NOT NULL REFERENCES player_characters(id) ON DELETE RESTRICT,
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Tipo de participação (aventureiro principal ou reserva)
  type            participant_type NOT NULL DEFAULT 'PLAYER',

  -- Rastreamento
  joined_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  left_at         TIMESTAMPTZ,                          -- saiu do arco (sem invalidar histórico)

  -- Recompensas recebidas ao fechar o arco
  xp_awarded      NUMERIC(12,4),
  gold_awarded    NUMERIC(12,4),
  awarded_at      TIMESTAMPTZ,

  UNIQUE (arc_id, character_id),
  UNIQUE (arc_id, user_id)                              -- um personagem por usuário por arco
);

CREATE INDEX IF NOT EXISTS idx_arcp_arc_id
  ON arc_participants (arc_id);
CREATE INDEX IF NOT EXISTS idx_arcp_character_id
  ON arc_participants (character_id);
CREATE INDEX IF NOT EXISTS idx_arcp_user_id
  ON arc_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_arcp_mission_id
  ON arc_participants (mission_id);

-- Garante que um personagem só participa de um arco ATIVO por vez
-- (partial unique index: só conflita quando o arco está ativo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_arcp_character_active_arc
  ON arc_participants (character_id)
  WHERE left_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Adiciona arc_id e mission_id em SESSION_LOGS
--    (vínculo explícito Sessão → Arco → Missão)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE session_logs
  ADD COLUMN IF NOT EXISTS arc_id     UUID REFERENCES mission_arcs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mission_id UUID REFERENCES missions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sl_arc_id
  ON session_logs (arc_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sl_mission_id
  ON session_logs (mission_id) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Adiciona arc_id, mission_id e out_of_session em RESOURCE_DELTAS
--    out_of_session = TRUE quando a sessão estava fechada no momento do evento
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE resource_deltas
  ADD COLUMN IF NOT EXISTS arc_id          UUID    REFERENCES mission_arcs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mission_id      UUID    REFERENCES missions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS out_of_session  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS character_id    UUID    REFERENCES player_characters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rd_arc_id
  ON resource_deltas (arc_id);
CREATE INDEX IF NOT EXISTS idx_rd_mission_id
  ON resource_deltas (mission_id);
CREATE INDEX IF NOT EXISTS idx_rd_out_of_session
  ON resource_deltas (out_of_session) WHERE out_of_session = TRUE;
CREATE INDEX IF NOT EXISTS idx_rd_character_id
  ON resource_deltas (character_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. REMOVE a constraint que bloqueia INSERT em sessão fechada
--    Substituída por lógica no backend que seta out_of_session = TRUE
--    (preserva sincronização com o Foundry sem perder auditabilidade)
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_rd_guard_session_open ON resource_deltas;

-- Mantém a função caso seja necessário reativar o guard em outros contextos
-- mas não a ativa como trigger.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. VIEW atualizada: v_arc_player_totals
--    Totais por jogador por ARCO (base para distribuição de recompensas)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_arc_player_totals AS
SELECT
  rd.arc_id,
  ma.title                                   AS arc_title,
  ma.status                                  AS arc_status,
  ma.mission_id,
  rd.character_id,
  pc.name                                    AS character_name,
  rd.player_id,
  COALESCE(u.display_name, u.name)           AS player_name,
  rd.resource_type,
  SUM(rd.delta)                              AS total_delta,
  COUNT(*)                                   AS event_count,
  MIN(rd.occurred_at)                        AS first_event,
  MAX(rd.occurred_at)                        AS last_event
FROM resource_deltas AS rd
INNER JOIN mission_arcs AS ma     ON ma.id = rd.arc_id
INNER JOIN users AS u             ON u.id  = rd.player_id
LEFT  JOIN player_characters AS pc ON pc.id = rd.character_id
WHERE rd.deleted_at IS NULL
  AND ma.deleted_at IS NULL
  AND rd.out_of_session = FALSE    -- só eventos dentro de sessão
GROUP BY
  rd.arc_id, ma.title, ma.status, ma.mission_id,
  rd.character_id, pc.name,
  rd.player_id, u.display_name, u.name,
  rd.resource_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VIEW: v_mission_arc_timeline
--    Linha do tempo completa de uma missão: arcos + sessões
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_mission_arc_timeline AS
SELECT
  m.id                                       AS mission_id,
  m.title                                    AS mission_title,
  ma.id                                      AS arc_id,
  ma.arc_number,
  ma.title                                   AS arc_title,
  ma.status                                  AS arc_status,
  ma.started_at                              AS arc_started_at,
  ma.closed_at                               AS arc_closed_at,
  sl.id                                      AS session_id,
  sl.session_number,
  sl.title                                   AS session_title,
  sl.status                                  AS session_status,
  sl.started_at                              AS session_started_at,
  sl.closed_at                               AS session_closed_at,
  COUNT(DISTINCT ap.character_id)            AS participant_count,
  COUNT(DISTINCT rd.id)                      AS event_count
FROM missions AS m
INNER JOIN mission_arcs AS ma     ON ma.mission_id = m.id AND ma.deleted_at IS NULL
LEFT  JOIN session_logs AS sl     ON sl.arc_id = ma.id    AND sl.deleted_at IS NULL
LEFT  JOIN arc_participants AS ap ON ap.arc_id = ma.id    AND ap.left_at IS NULL
LEFT  JOIN resource_deltas AS rd  ON rd.session_id = sl.id AND rd.deleted_at IS NULL
GROUP BY
  m.id, m.title,
  ma.id, ma.arc_number, ma.title, ma.status, ma.started_at, ma.closed_at,
  sl.id, sl.session_number, sl.title, sl.status, sl.started_at, sl.closed_at
ORDER BY ma.arc_number, sl.started_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Trigger: updated_at para mission_arcs
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_arc_updated_at ON mission_arcs;
CREATE TRIGGER trg_arc_updated_at
  BEFORE UPDATE ON mission_arcs
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Guard de exclusividade de arco ativo por personagem
--     (Função PL/pgSQL para uso no backend via query direta)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_check_character_arc_conflict(
  p_character_id UUID,
  p_arc_id       UUID  -- arco que queremos adicionar o personagem
) RETURNS TABLE (
  conflict_arc_id    UUID,
  conflict_arc_title TEXT,
  mission_title      TEXT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.arc_id,
    ma.title,
    m.title
  FROM arc_participants ap
  INNER JOIN mission_arcs ma ON ma.id = ap.arc_id
  INNER JOIN missions m      ON m.id  = ma.mission_id
  WHERE ap.character_id = p_character_id
    AND ap.left_at IS NULL
    AND ma.status = 'active'
    AND ap.arc_id != p_arc_id;
END;
$$;

COMMIT;
