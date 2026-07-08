-- 029_session_events.sql
--
-- Event Store do nimrod-session: fatos estruturais da sessão que NÃO são
-- consumo de recurso. Tabela própria, separada de resource_deltas por
-- decisão explícita de arquitetura — as duas têm domínios diferentes e
-- não devem compartilhar uma tabela nem um endpoint.
--
-- resource_deltas  → "quanto recurso o personagem X consumiu/ganhou"
-- session_events   → "o que aconteceu na mesa" (presença, cena, combate,
--                     tokens, e qualquer fato futuro: porta abriu, NPC
--                     falou, macro executada, etc.)
--
-- event_type é TEXT livre, sem ENUM — cada registry do módulo Foundry
-- (PLAYER_HANDLERS, SCENE_HANDLERS, COMBAT_HANDLERS, TOKEN_HANDLERS, ...)
-- define seus próprios valores. Adicionar um novo tipo de evento nunca
-- exige migration.
--
-- actor_id/character_id/player_id são todos OPCIONAIS — muitos eventos
-- estruturais genuinamente não têm dono (SCENE_CHANGED, COMBAT_STARTED),
-- e não fabricamos um proprietário artificial para eles. Quando um evento
-- TEM um ator (ex: TOKEN_APPEARED de um NPC específico, ou presença de um
-- jogador), os campos são preenchidos normalmente — inclusive para NPCs,
-- que nunca terão character_id/player_id (não existem como personagem
-- Nimrod), mas ainda assim têm actor_id (o Foundry actor._id bruto).
--
-- session_id usa ON DELETE RESTRICT (mesmo padrão de resource_deltas.session_id)
-- — uma sessão nunca é apagada silenciosamente arrastando seu log de eventos
-- junto; isso contradiria o propósito de auditoria desta tabela.

BEGIN;

CREATE TABLE IF NOT EXISTS session_events (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id   UUID          NOT NULL REFERENCES session_logs(id) ON DELETE RESTRICT,
  mission_id   UUID          REFERENCES missions(id) ON DELETE SET NULL,

  event_type   TEXT          NOT NULL,
  occurred_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Identidade do ator, quando aplicável. actor_id é o Foundry actor._id
  -- bruto (TEXT, não FK — vale para NPCs, que nunca existem como
  -- player_characters). character_id/player_id só são preenchidos quando
  -- o actor_id corresponde a um personagem Nimrod sincronizado.
  actor_id     TEXT,
  actor_name   TEXT,
  character_id UUID          REFERENCES player_characters(id) ON DELETE SET NULL,
  player_id    UUID          REFERENCES users(id) ON DELETE SET NULL,

  -- Dados específicos do evento — formato livre por event_type. Nunca
  -- contém texto narrativo/interpretativo (isso é responsabilidade de um
  -- módulo futuro, não do nimrod-session).
  payload      JSONB         NOT NULL DEFAULT '{}',

  -- Idempotência — mesmo mecanismo de resource_deltas.foundry_event_id.
  foundry_event_id TEXT      UNIQUE,

  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Timeline cronológica por sessão — a consulta mais comum desta tabela.
CREATE INDEX IF NOT EXISTS idx_se_session_occurred
  ON session_events (session_id, occurred_at);

-- Filtro por categoria de evento (ex: todos os PLAYER_CONNECTED da sessão).
CREATE INDEX IF NOT EXISTS idx_se_event_type
  ON session_events (event_type);

-- Histórico de um personagem específico entre sessões.
CREATE INDEX IF NOT EXISTS idx_se_character_id
  ON session_events (character_id)
  WHERE character_id IS NOT NULL;

-- Histórico de um jogador específico entre sessões.
CREATE INDEX IF NOT EXISTS idx_se_player_id
  ON session_events (player_id)
  WHERE player_id IS NOT NULL;

-- Histórico completo de uma missão/campanha (várias sessões).
CREATE INDEX IF NOT EXISTS idx_se_mission_id
  ON session_events (mission_id)
  WHERE mission_id IS NOT NULL;

-- Consultas flexíveis sobre o conteúdo de payload (ex: sceneId específico).
CREATE INDEX IF NOT EXISTS idx_se_payload_gin
  ON session_events USING GIN (payload);

COMMIT;