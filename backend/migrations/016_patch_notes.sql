-- 016_patch_notes.sql
-- Notas de atualização e patch linkadas ao Homebrewery (ou PDF).
-- Criadas pelo GM, visíveis a todos os jogadores.

BEGIN;

CREATE TABLE IF NOT EXISTS patch_notes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Metadados visíveis
  title         TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  version       TEXT        NOT NULL CHECK (char_length(version) BETWEEN 1 AND 30),
  summary       TEXT                 CHECK (char_length(summary) <= 500),

  -- Fonte do documento (ao menos um dos dois deve estar preenchido)
  homebrew_url  TEXT,                -- https://homebrewery.naturalcrit.com/share/{id}
  file_url      TEXT,                -- /uploads/patch-notes/{filename}  (PDF/imagem)

  -- Controle
  published     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraint: ao menos um dos campos de fonte deve estar preenchido
ALTER TABLE patch_notes
  ADD CONSTRAINT chk_patch_notes_source
  CHECK (homebrew_url IS NOT NULL OR file_url IS NOT NULL);

-- Validação básica do domínio do Homebrewery no banco
-- (a validação completa fica no backend)
ALTER TABLE patch_notes
  ADD CONSTRAINT chk_homebrew_url_domain
  CHECK (
    homebrew_url IS NULL
    OR homebrew_url LIKE 'https://homebrewery.naturalcrit.com/%'
  );

CREATE INDEX IF NOT EXISTS idx_patch_notes_created_at
  ON patch_notes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patch_notes_published
  ON patch_notes(published, created_at DESC);

COMMIT;
