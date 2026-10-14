import { ManaAccess, requireManaServer } from '../services/manaAccess.js';
import { requireAuth } from '../lib/roles.js';

// Registered after Nimrod's existing human authentication hook.
export async function manaPlayerRoutes(app) {
  app.post('/mana/launch', {
    schema: { body: { type: 'object', required: ['character_id'], additionalProperties: false,
      properties: { character_id: { type: 'string', format: 'uuid' } } } },
  }, async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;
    return ManaAccess.launchLobby(req.user, req.body.character_id);
  });
}

// Registered before the human authentication hook; every route authenticates the game server.
export async function manaBridgeRoutes(app) {
  app.post('/mana/redeem', {
    preHandler: requireManaServer,
    schema: { body: { type: 'object', required: ['token'], additionalProperties: false,
      properties: { token: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } },
  }, async req => ManaAccess.redeem(req.body.token));
  app.post('/mana/authorize', {
    preHandler: requireManaServer,
    schema: { body: { type: 'object', required: ['grant_id'], additionalProperties: false,
      properties: { grant_id: { type: 'string', format: 'uuid' } } } },
  }, async req => ManaAccess.authorize(req.body.grant_id));
}
