-- 027_resource_deltas_snapshot_delta_check.sql
--
-- Corrige um bug pré-existente: resource_deltas.delta tem CHECK (delta != 0)
-- a nível de banco. O snapshot de HP registrado em deleteCombat (fim de
-- combate) legitimamente usa delta=0 com deltaMeta.snapshot=true — esse
-- INSERT sempre falharia com "violates check constraint", mesmo com a
-- validação de aplicação (validateEventBody) já permitindo o caso.
--
-- Escopo estritamente limitado a esse bug — resource_deltas continua
-- sendo exclusivamente o log de consumo de recurso (player_id, registered_by
-- e actor_name continuam NOT NULL). Eventos estruturais sem dono (presença,
-- cena, combate, etc.) NÃO passam por aqui — têm tabela própria
-- (session_events, ver migration seguinte).

BEGIN;

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'resource_deltas'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%delta%!=%0%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE resource_deltas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE resource_deltas
  ADD CONSTRAINT chk_delta_nonzero_unless_snapshot
  CHECK (delta != 0 OR (delta_meta ->> 'snapshot') = 'true');

COMMIT;
