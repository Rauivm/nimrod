/**
 * middleware/auth.js
 *
 * Fluxo de autenticação:
 *
 * Desenvolvimento (DEV_USER_EMAIL definido no .env):
 *   → bypassa Cloudflare e usa o email/role do .env
 *
 * Produção (Cloudflare Tunnel + Cloudflare Access):
 *   → Cloudflare Access autentica o usuário ANTES de a request chegar aqui
 *   → Cloudflare injeta o header `cf-access-authenticated-user-email`
 *   → O backend confia nesse header porque o origin só é acessível via Tunnel
 *
 * IMPORTANTE — por que NÃO verificamos cf-ray ou JWT aqui:
 *   → cf-ray é um header do lado do *cliente*, não do origin. O Tunnel não o injeta.
 *   → A validação manual do JWT do CF Access requer buscar as chaves públicas do CF
 *     e costuma quebrar. O modelo correto é confiar na rede (Tunnel), não re-validar.
 *   → Se a porta 3001 não estiver exposta publicamente (docker-compose correto),
 *     ninguém consegue forjar o header — segurança é na camada de rede.
 */

import { query } from '../db/index.js';

const FALLBACK_NAMES = [
  'Rapariga', 'Quenga', 'Bitch', 'Raissa Rayana', 'Bala Halls', 'Rapariga','Aventureiro', 'Forasteiro', 'Errante', 'Peregrino', 'Desconhecido',
];

export async function cfAuthMiddleware(request, reply) {
  // ── Modo desenvolvimento ──────────────────────────────────────────────────
  // Ativo apenas quando DEV_USER_EMAIL está no .env.
  // Em produção esse bloco nunca executa (variável não existe).
  const devEmail = process.env.DEV_USER_EMAIL?.trim();
  if (devEmail) {
    const devName = process.env.DEV_USER_NAME?.trim() || 'Dev User';
    const devRole = process.env.DEV_USER_ROLE?.trim() || 'PLAYER';
    request.user  = await upsertUser(devEmail, devName, devRole, true);
    return;
  }

  // ── Produção: header injetado pelo Cloudflare Access ─────────────────────
  const email = request.headers['cf-access-authenticated-user-email']?.trim().toLowerCase();

  if (!email) {
    if (reply) return reply.code(401).send({ error: 'Unauthorized' });
    throw new Error('Unauthorized');
  }

  const cfName = request.headers['cf-access-user-name']?.trim();
  const name   = cfName || email.split('@')[0];

  request.user = await upsertUser(email, name, 'PLAYER', false);
}

async function upsertUser(email, name, role, forceRole) {
  const sql = forceRole
    ? `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role
       RETURNING *`
    : `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name
       RETURNING *`;

  const res = await query(sql, [email, name, role]);
  return res.rows[0];
}

export function pickFallbackName() {
  return FALLBACK_NAMES[Math.floor(Math.random() * FALLBACK_NAMES.length)];
}
