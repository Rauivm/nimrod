-- 028_season_effects.sql
--
-- Efeitos mecânicos de estação (modificadores de regra), customizáveis pelo GM.
--
-- Diferente da config visual (frontend/src/config/calendarSeasons.js, que é
-- só cor/ícone/imagem estáticos), os EFEITOS de cada estação viram dados no
-- banco porque são balanceamento de jogo — o GM precisa poder editar sem
-- precisar de deploy.
--
-- Três tipos de efeito:
--   'check'  → perícia + vantagem/desvantagem (estilo D&D 5e)
--   'price'  → categoria de preço + multiplicador (1.30 = 30% mais caro)
--   'custom' → só texto de lore, sem mecânica associada
--
-- season_key usa as mesmas chaves do config visual do frontend
-- (WINTER/SPRING/SUMMER/AUTUMN), para não precisar de tradução em nenhum
-- dos dois lados.

BEGIN;

DO $$ BEGIN
  CREATE TYPE season_effect_kind AS ENUM ('check', 'price', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE season_effect_mode AS ENUM ('advantage', 'disadvantage');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS season_effects (
  id                UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  season_key        TEXT                 NOT NULL CHECK (season_key IN ('WINTER','SPRING','SUMMER','AUTUMN')),
  kind              season_effect_kind   NOT NULL,
  label             TEXT                 NOT NULL,

  -- usado quando kind = 'check'
  skill             TEXT,
  mode              season_effect_mode,

  -- usado quando kind = 'price'
  price_category    TEXT,
  price_multiplier  NUMERIC(5,2),

  sort_order        INTEGER              NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_by        UUID                 REFERENCES users(id),

  CONSTRAINT chk_season_effect_check_fields CHECK (
    kind <> 'check' OR (skill IS NOT NULL AND mode IS NOT NULL)
  ),
  CONSTRAINT chk_season_effect_price_fields CHECK (
    kind <> 'price' OR (price_category IS NOT NULL AND price_multiplier IS NOT NULL AND price_multiplier > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_season_effects_season_order
  ON season_effects(season_key, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed — valores de partida convertidos do texto de lore original.
-- São só um ponto de partida; o GM edita/apaga/adiciona pela UI depois.
-- Idempotente: só semeia uma estação se ela ainda não tiver nenhum efeito.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO season_effects (season_key, kind, label, skill, mode, sort_order)
SELECT * FROM (VALUES
  ('WINTER'::TEXT, 'check'::season_effect_kind, 'Dificuldade de rastreio'::TEXT, 'rastreio'::TEXT, 'disadvantage'::season_effect_mode, 0),
  ('WINTER',       'check',                     'Dificuldade de sobrevivência',  'sobrevivencia',   'disadvantage',                    1)
) AS v(season_key, kind, label, skill, mode, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'WINTER');

INSERT INTO season_effects (season_key, kind, label, price_category, price_multiplier, sort_order)
SELECT * FROM (VALUES
  ('WINTER'::TEXT, 'price'::season_effect_kind, 'Alimentos mais caros'::TEXT, 'alimento'::TEXT, 1.30::NUMERIC(5,2), 2),
  ('WINTER',       'price',                     'Estadia mais cara',          'estadia',         1.30,               3)
) AS v(season_key, kind, label, price_category, price_multiplier, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'WINTER' AND price_category IS NOT NULL);

INSERT INTO season_effects (season_key, kind, label, price_category, price_multiplier, sort_order)
SELECT * FROM (VALUES
  ('SPRING'::TEXT, 'price'::season_effect_kind, 'Redução no custo de alimentos'::TEXT, 'alimento'::TEXT, 0.80::NUMERIC(5,2), 0)
) AS v(season_key, kind, label, price_category, price_multiplier, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'SPRING' AND price_category IS NOT NULL);

INSERT INTO season_effects (season_key, kind, label, sort_order)
SELECT * FROM (VALUES
  ('SPRING'::TEXT, 'custom'::season_effect_kind, 'Aumento no número de bestas e doenças'::TEXT, 1),
  ('SPRING',       'custom',                     'Início do ano — festas de colheita',          2)
) AS v(season_key, kind, label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'SPRING' AND kind = 'custom');

INSERT INTO season_effects (season_key, kind, label, skill, mode, sort_order)
SELECT * FROM (VALUES
  ('SUMMER'::TEXT, 'check'::season_effect_kind, 'Facilidade de rastreio'::TEXT, 'rastreio'::TEXT, 'advantage'::season_effect_mode, 0)
) AS v(season_key, kind, label, skill, mode, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'SUMMER' AND kind = 'check');

INSERT INTO season_effects (season_key, kind, label, sort_order)
SELECT * FROM (VALUES
  ('SUMMER'::TEXT, 'custom'::season_effect_kind, 'Calor intenso e chuvas fortes'::TEXT, 1),
  ('SUMMER',       'custom',                     'Época de reprodução das bestas',      2)
) AS v(season_key, kind, label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'SUMMER' AND kind = 'custom');

INSERT INTO season_effects (season_key, kind, label, price_category, price_multiplier, sort_order)
SELECT * FROM (VALUES
  ('AUTUMN'::TEXT, 'price'::season_effect_kind, 'Escassez de alimentos'::TEXT, 'alimento'::TEXT, 1.20::NUMERIC(5,2), 0)
) AS v(season_key, kind, label, price_category, price_multiplier, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'AUTUMN' AND price_category IS NOT NULL);

INSERT INTO season_effects (season_key, kind, label, skill, mode, sort_order)
SELECT * FROM (VALUES
  ('AUTUMN'::TEXT, 'check'::season_effect_kind, 'Dificuldade moderada de rastreio'::TEXT,       'rastreio'::TEXT,      'disadvantage'::season_effect_mode, 1),
  ('AUTUMN',       'check',                     'Dificuldade moderada de sobrevivência',        'sobrevivencia',       'disadvantage',                     2)
) AS v(season_key, kind, label, skill, mode, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM season_effects WHERE season_key = 'AUTUMN' AND kind = 'check');

COMMIT;
