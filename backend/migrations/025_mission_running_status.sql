-- 025_mission_running_status.sql
--
-- 1. Adiciona RUNNING ao enum mission_status
--    OPEN      → inscrições abertas
--    CLOSED    → inscrições fechadas, aguardando início
--    RUNNING   → campanha em andamento (sessão ativa vinculada ao Foundry)
--    FINISHED  → encerrada
--
-- 2. Remove expires_at de foundry_handshakes:
--    O código agora é válido durante toda a campanha, não expira em 10min.
--    Só é invalidado quando a missão é encerrada (mission_id FK + claimed_at preenchido).
--
-- 3. Adiciona mission_id em foundry_handshakes para invalidar ao encerrar.

BEGIN;

ALTER TYPE mission_status ADD VALUE IF NOT EXISTS 'RUNNING' AFTER 'CLOSED';

-- Remove o TTL automático — o código agora é permanente enquanto a campanha existir
ALTER TABLE foundry_handshakes
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT NULL;

-- Vincula o handshake diretamente à missão para facilitar invalidação
ALTER TABLE foundry_handshakes
  ADD COLUMN IF NOT EXISTS mission_id UUID REFERENCES missions(id) ON DELETE SET NULL;

-- Índice para buscar handshake ativo por missão
CREATE INDEX IF NOT EXISTS idx_fh_mission_id
  ON foundry_handshakes (mission_id)
  WHERE claimed_at IS NOT NULL;

COMMIT;