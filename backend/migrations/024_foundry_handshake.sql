-- 024_foundry_handshake.sql
--
-- Tabela de handshake temporário entre o módulo Foundry e o Nimrod.
--
-- Fluxo:
--   1. Módulo Foundry inicializa → gera código curto → POST /nimrod/handshake
--   2. Nimrod armazena estado do mundo por até 10 minutos
--   3. GM insere o código ao abrir sessão no Nimrod → POST /sessions/:id/link-foundry
--   4. Nimrod vincula session_id ao handshake
--   5. Módulo faz polling em GET /nimrod/handshake/status?code=XXX até receber session_id
--   6. Após receber session_id, módulo começa a enviar eventos com ele
--
-- O código expira em 10 minutos (controlled por query, sem cron job).
-- Após claim, o registro é mantido para auditoria por 24h.

BEGIN;

CREATE TABLE IF NOT EXISTS foundry_handshakes (
  -- Código exibido no Foundry para o GM digitar no Nimrod.
  -- 7 caracteres alfanuméricos maiúsculos, excluindo 0/O/1/I para legibilidade.
  code          TEXT        PRIMARY KEY,

  -- Identificador do mundo Foundry (game.world.id)
  world_id      TEXT        NOT NULL,

  -- Nome do GM conectado no Foundry no momento do handshake
  gm_name       TEXT,

  -- Estado do mundo no momento do handshake (jogadores online, personagens, tokens)
  -- Armazenado como JSONB para flexibilidade — estrutura detalhada no módulo.
  players       JSONB       NOT NULL DEFAULT '[]',
  tokens        JSONB       NOT NULL DEFAULT '[]',

  -- Controle de ciclo de vida
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  claimed_at    TIMESTAMPTZ,               -- NULL = aguardando; preenchido ao vincular

  -- Preenchido após o GM vincular com uma sessão no Nimrod
  session_id    UUID        REFERENCES session_logs(id) ON DELETE SET NULL,

  -- Quem fez o claim (para auditoria)
  claimed_by    UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- Índice para polling eficiente do módulo (GET /nimrod/handshake/status?code=X)
CREATE INDEX IF NOT EXISTS idx_fh_code_expires
  ON foundry_handshakes (code, expires_at)
  WHERE claimed_at IS NULL;

-- Índice para limpar registros antigos
CREATE INDEX IF NOT EXISTS idx_fh_expires_at
  ON foundry_handshakes (expires_at);

COMMIT;
