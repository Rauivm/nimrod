-- 027_world_calendar.sql
--
-- Módulo: Calendário do Mundo (MVP - Etapa 1)
--
-- Guarda APENAS o estado atual do calendário (a sessão corrente do mundo).
-- Ano, estação, semana da estação etc. são sempre derivados dessa sessão
-- em tempo de execução pelo CalendarService — nunca armazenados aqui.
-- Isso evita que os dois valores fiquem dessincronizados e mantém a regra
-- de estações centralizada em um único lugar do código.
--
-- world_calendar é uma tabela "singleton": a constraint (id = 1) garante
-- que só pode existir uma única linha.
--
-- world_calendar_audit registra toda alteração da sessão corrente
-- (avançar, voltar, definir manualmente), com quem fez e quando.
--
-- Idempotência: CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WORLD_CALENDAR — estado atual (singleton)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS world_calendar (
  id              INTEGER       PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_session INTEGER       NOT NULL CHECK (current_session >= 1),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by      UUID          REFERENCES users(id)
);

COMMENT ON TABLE world_calendar IS
'Estado atual do calendário do mundo. Linha única (id=1). Ano/estação/semana são calculados a partir de current_session pelo CalendarService, nunca armazenados aqui.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WORLD_CALENDAR_AUDIT — trilha de auditoria de alterações
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE world_calendar_action AS ENUM ('next', 'previous', 'set');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS world_calendar_audit (
  id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_session  INTEGER                 NOT NULL,
  new_session       INTEGER                 NOT NULL,
  action            world_calendar_action   NOT NULL,
  changed_by        UUID                    NOT NULL REFERENCES users(id),
  changed_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_calendar_audit_changed_at
  ON world_calendar_audit(changed_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed — sessão corrente atual do mundo (Ano 141 DC, sessão 205)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO world_calendar (id, current_session, updated_by)
VALUES (1, 205, NULL)
ON CONFLICT (id) DO NOTHING;

COMMIT;
