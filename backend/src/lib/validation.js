/**
 * src/lib/validation.js
 *
 * Helpers de validação simples e compartilhados entre rotas.
 */

// Regex UUID v4 — evita que strings inválidas causem erro 500 no PostgreSQL
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}