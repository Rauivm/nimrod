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
 * 
 *  * NOVIDADE: header X-Dev-User
 *   Em modo dev (NODE_ENV !== 'production'), o header X-Dev-User permite
 *   simular qualquer usuário sem reiniciar o servidor.
 *
 *   Valor: email do usuário que já existe no banco (criado via dev_seed_users.sql)
 *   Exemplo: X-Dev-User: thorin@local.dev
 *
 *   NUNCA funciona em produção — bloqueado por NODE_ENV check.
 *
 * Fluxo completo:
 *
 *   DEV  + X-Dev-User header  → usa o email do header (multi-usuário)
 *   DEV  + DEV_USER_EMAIL env → usa o email do .env (usuário fixo, como antes)
 *   PROD + cf-access header   → Cloudflare Access (produção)
 */

import { query } from '../db/index.js';

const FALLBACK_NAMES = [
  'Rapariga', 'Quenga', 'Bitch', 'Raissa Rayana', 'Bala Halls', 'Rapariga','Aventureiro', 'Forasteiro', 'Errante', 'Peregrino', 'Desconhecido',
];

const IS_DEV = process.env.NODE_ENV !== 'production';
 
export async function cfAuthMiddleware(request, reply) {
 
  // ── 1. Header X-Dev-User (dev only, multi-usuário) ───────────────────────
  // Permite trocar de usuário por request sem reiniciar o servidor.
  // Bloqueado em produção por IS_DEV.
  if (IS_DEV) {
    const devSwitchEmail = request.headers['x-dev-user']?.trim().toLowerCase();
    if (devSwitchEmail) {
      // Busca o usuário existente no banco (não faz upsert — o usuário
      // deve existir, criado via dev_seed_users.sql)
      const res = await query(
        'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
        [devSwitchEmail],
      );
      if (res.rows.length) {
        request.user = res.rows[0];
        return;
      }
      // Email não encontrado → avisa e cai no fluxo normal
      request.log?.warn(`X-Dev-User: email "${devSwitchEmail}" não encontrado no banco.`);
    }
  }
 
  // ── 2. DEV_USER_EMAIL no .env (usuário fixo, comportamento original) ──────
  const devEmail = process.env.DEV_USER_EMAIL?.trim();
  if (devEmail) {
    const devName = process.env.DEV_USER_NAME?.trim() || 'Dev User';
    const devRole = process.env.DEV_USER_ROLE?.trim() || 'GM';
    request.user  = await upsertUser(devEmail, devName, devRole, true);
    return;
  }
 
  // ── 3. Produção: Cloudflare Access ───────────────────────────────────────
  const email = request.headers['cf-access-authenticated-user-email']?.trim().toLowerCase();
 
  if (!email) {
    if (reply) return reply.code(401).send({ error: 'Unauthorized' });
    throw new Error('Unauthorized');
  }
 
  const cfName = request.headers['cf-access-user-name']?.trim();
  const name   = cfName || email.split('@')[0];
 
  request.user = await upsertUser(
    email,
    name,
    process.env.DEV_USER_ROLE ?? 'PLAYER',
    false,
  );
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