-- 026_resource_deltas_participant_flag.sql

BEGIN;

ALTER TABLE resource_deltas
ADD COLUMN participant BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN resource_deltas.participant IS
'Indica se o personagem participava da missão quando o evento foi registrado.';

CREATE INDEX idx_resource_deltas_participant
ON resource_deltas(participant);

COMMIT;