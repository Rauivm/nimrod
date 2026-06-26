/**
 * src/lib/roles.js
 *
 * Fonte única de verdade para verificações de role no backend.
 *
 * Hierarquia de permissões (do menor para o maior):
 *   PLAYER < GM < GM_PRINCIPAL
 *
 * GM_PRINCIPAL herda TODAS as permissões de GM e PLAYER.
 * GM herda TODAS as permissões de PLAYER.
 *
 * Uso:
 *   import { isGM, isGMPrincipal, isPlayer, requireGM, requireGMPrincipal } from '../lib/roles.js';
 *
 *   if (!requireGM(req, reply)) return reply;
 *   if (isGM(req.user)) { ... }
 */

// Conjunto de roles que têm privilégios de GM (incluindo GM_PRINCIPAL)
export const GM_ROLES        = new Set(['GM', 'GM_PRINCIPAL']);
// Todos os roles válidos do sistema
export const ALL_ROLES       = new Set(['PLAYER', 'GM', 'GM_PRINCIPAL']);
// Roles que podem administrar vínculos de personagens para outros usuários
export const ADMIN_ROLES     = new Set(['GM', 'GM_PRINCIPAL']);

/**
 * Retorna true se o usuário tem privilégios de GM ou superior.
 * GM_PRINCIPAL também retorna true.
 *
 * @param {object|null} user - req.user injetado pelo cfAuthMiddleware
 * @returns {boolean}
 */
export function isGM(user) {
  return GM_ROLES.has(user?.role);
}

/**
 * Retorna true SOMENTE para GM_PRINCIPAL.
 * Usado para ações administrativas: abrir/fechar sessão, editar eventos retroativamente.
 *
 * @param {object|null} user
 * @returns {boolean}
 */
export function isGMPrincipal(user) {
  return user?.role === 'GM_PRINCIPAL';
}

/**
 * Retorna true para qualquer usuário autenticado (PLAYER, GM, GM_PRINCIPAL).
 *
 * @param {object|null} user
 * @returns {boolean}
 */
export function isPlayer(user) {
  return ALL_ROLES.has(user?.role);
}

/**
 * Retorna true se o usuário pode administrar personagens de outros usuários.
 * GM e GM_PRINCIPAL podem linkar/desvincular personagens de qualquer jogador.
 *
 * @param {object|null} user
 * @returns {boolean}
 */
export function isAdmin(user) {
  return ADMIN_ROLES.has(user?.role);
}

// ─── Guards de rota (return false e já enviou 403) ────────────────────────────

/**
 * Guard: exige GM ou GM_PRINCIPAL.
 * Se falhar, envia 403 e retorna false.
 * Se passar, retorna true.
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {boolean}
 */
export function requireGM(req, reply) {
  if (!isGM(req.user)) {
    reply.code(403).send({ error: 'Apenas GMs podem acessar este recurso.' });
    return false;
  }
  return true;
}

/**
 * Guard: exige exatamente GM_PRINCIPAL.
 * Se falhar, envia 403 e retorna false.
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {boolean}
 */
export function requireGMPrincipal(req, reply) {
  if (!isGMPrincipal(req.user)) {
    reply.code(403).send({ error: 'Apenas o GM Principal pode executar esta ação.' });
    return false;
  }
  return true;
}

/**
 * Guard: exige usuário autenticado (qualquer role).
 * Na prática o cfAuthMiddleware já garante isso, mas útil para clareza.
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {boolean}
 */
export function requireAuth(req, reply) {
  if (!req.user?.id) {
    reply.code(401).send({ error: 'Autenticação necessária.' });
    return false;
  }
  return true;
}

/**
 * Guard: exige admin (GM ou GM_PRINCIPAL) para operações em outros usuários.
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {boolean}
 */
export function requireAdmin(req, reply) {
  if (!isAdmin(req.user)) {
    reply.code(403).send({ error: 'Apenas GMs podem administrar personagens de outros jogadores.' });
    return false;
  }
  return true;
}

/**
 * Retorna o label de exibição para um role.
 * Compatível com frontend e backend.
 *
 * @param {string} role
 * @returns {string}
 */
export function roleLabel(role) {
  switch (role) {
    case 'GM_PRINCIPAL': return 'Mestre Principal';
    case 'GM':           return 'Mestre';
    case 'PLAYER':       return 'Jogador';
    default:             return role ?? 'Desconhecido';
  }
}
