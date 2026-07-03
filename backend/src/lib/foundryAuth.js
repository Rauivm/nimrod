/**
 * src/lib/foundryAuth.js
 *
 * Fonte única de verdade para validação da chave de API do módulo Foundry
 * (X-Nimrod-Key). Antes desta extração, a mesma comparação timing-safe
 * existia duplicada em index.js (hook global de auth) e em cada rota que
 * aceita chamadas do módulo Foundry (sessions.js, foundry.js) — qualquer
 * mudança na regra exigia editar vários arquivos em sincronia.
 *
 * Uso:
 *   import { isFoundryRequest } from '../lib/foundryAuth.js';
 *
 *   // Em index.js (hook global, decide se pula cfAuthMiddleware):
 *   if (await isFoundryRequest(req)) return;
 *
 *   // Em uma rota (decide o caminho de autorização):
 *   const isFoundryOrigin = await isFoundryRequest(req);
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Verifica se a requisição carrega uma X-Nimrod-Key válida.
 *
 * @param {import('fastify').FastifyRequest} req
 * @returns {Promise<boolean>}
 */
export async function isFoundryRequest(req) {
  const sentKey       = req.headers['x-nimrod-key'];
  const configuredKey = process.env.FOUNDRY_API_KEY?.trim();

  if (!sentKey || !configuredKey) return false;
  if (sentKey.length !== configuredKey.length) return false;

  return timingSafeEqual(Buffer.from(sentKey), Buffer.from(configuredKey));
}