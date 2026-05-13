/**
 * app.js — Fastify application factory.
 */

import Fastify from 'fastify';

import { signFoundryToken, verifyFoundryToken } from './services/foundryAuth.js';
import { resolveFoundryMapping } from './services/foundryMap.js';
import { pool } from './db/index.js';   // ← Importe o pool diretamente

const {
  NODE_ENV = 'development',
  DEV_USER_EMAIL,
  DEV_USER_NAME = 'Dev User',
  DEV_USER_ROLE = 'PLAYER',
  FOUNDRY_URL,
  FOUNDRY_JWT_SECRET,
} = process.env;

const IS_PROD = NODE_ENV === 'production';

if (!FOUNDRY_JWT_SECRET) {
  throw new Error('FOUNDRY_JWT_SECRET is required');
}

// ====================== UPSERT USER ======================
async function upsertUser(email, name, role = 'PLAYER') {
  const sql = `
    INSERT INTO users (email, name, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) 
    DO UPDATE 
      SET name = EXCLUDED.name,
          role = EXCLUDED.role
    RETURNING *`;

  const { rows } = await pool.query(sql, [email, name, role]);  // ← usando pool.query
  return rows[0];
}

// ====================== BUILD ======================
export async function build({ mockUser = null, logger = false } = {}) {
  const fastify = Fastify({ logger });

  fastify.setErrorHandler((error, request, reply) => {
    request.log?.error(error);
    return reply.code(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // ====================== AUTHENTICATE ======================
  fastify.decorate('authenticate', async (request, reply) => {
    // Mock (testes)
    if (mockUser?.email) {
      request.user = mockUser;
      return;
    }

    // Desenvolvimento
    if (!IS_PROD && DEV_USER_EMAIL) {
      request.user = await upsertUser(DEV_USER_EMAIL, DEV_USER_NAME, DEV_USER_ROLE);
      return;
    }

    // Produção - Cloudflare
    const email = request.headers['cf-access-authenticated-user-email'];
    if (!email) {
      return reply.code(401).send({ error: 'Unauthorized - Cloudflare Access required' });
    }

    if (!request.headers['cf-ray']) {
      return reply.code(403).send({ error: 'Direct access forbidden' });
    }

    const name = request.headers['cf-access-user-name']?.trim() || email.split('@')[0];
    request.user = await upsertUser(email, name);
  });

  // ====================== ROTAS PÚBLICAS ======================
  fastify.get('/health', () => ({ status: 'ok' }));
  
  fastify.get('/api/config', async () => {
    return {
      // suas configurações públicas aqui
      foundryUrl: FOUNDRY_URL,
      isProd: IS_PROD,
    };
  });

  // ====================== ROTAS PROTEGIDAS ======================
  fastify.register(async function protectedRoutes(f) {
    f.addHook('preHandler', f.authenticate);

    f.get('/api/me', async (req) => ({
      authenticated: true,
      user: req.user,
    }));

    // Adicione aqui outras rotas /api/* que precisam de auth
    // f.get('/api/online-users', ...)
  });

  // ====================== Foundry Routes ======================
  fastify.get('/foundry/launch', {
    preHandler: fastify.authenticate,
    handler: async (req, reply) => { ... } // mantenha sua lógica original
  });

  fastify.post('/nimrod/verify', async (req, reply) => { ... }); // sua lógica original

  await fastify.ready();
  return fastify;
}