// Disposable browser fixture. It is never imported by src/index.js.
import { fileURLToPath } from 'node:url';
const connection = process.env.MISSION_TEST_DATABASE_URL;
const url = new URL(connection || 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.port !== '55438' || url.pathname !== '/mission_audit_test') {
  throw new Error('This fixture only accepts the disposable mission_audit_test database at 127.0.0.1:55438');
}
Object.assign(process.env, {
  DATABASE_URL: connection,
  NODE_ENV: 'test',
  DEV_USER_EMAIL: 'browser-gm@example.test',
  DEV_USER_NAME: 'Audit GM',
  DEV_USER_ROLE: 'GM',
  FOUNDRY_JWT_SECRET: 'mission-audit-synthetic-secret-only',
  FOUNDRY_API_KEY: 'mission-audit-synthetic-key-only',
  DISCORD_WEBHOOK_URL: '',
  FOUNDRY_SYNC_DISABLED: 'true'
});
const {
  default: Fastify
} = await import('../../node_modules/fastify/fastify.js');
const {
  default: websocket
} = await import('../../node_modules/@fastify/websocket/index.js');
const {
  default: staticFiles
} = await import('../../node_modules/@fastify/static/index.js');
const {
  pool,
  query,
  runMigrations
} = await import('../../src/db/index.js');
const {
  cfAuthMiddleware
} = await import('../../src/middleware/auth.js');
const {
  registerClient
} = await import('../../src/ws/broadcast.js');
await runMigrations();
for (const [email, role, name] of [['browser-gm@example.test', 'GM', 'Audit GM'], ['browser-player@example.test', 'PLAYER', 'Audit Player']]) {
  await query(`INSERT INTO users(email,name,display_name,role,lgpd_consent)
    VALUES($1,$3,$3,$2,TRUE) ON CONFLICT(email) DO NOTHING`, [email, role, name]);
}
const app = Fastify();
app.setErrorHandler((error, _req, reply) => reply.code(error.statusCode || 500).send({
  error: error.message
}));
await app.register(websocket);
app.get('/ws', {
  websocket: true
}, async (connection, req) => {
  await cfAuthMiddleware(req, {
    code: () => ({
      send: () => {}
    })
  });
  registerClient(connection.socket || connection, req.user.id);
});
await app.register(async api => {
  api.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/nimrod/')) await cfAuthMiddleware(req, reply);
  });
  const {
    userRoutes,
    configRoutes
  } = await import('../../src/routes/users.js');
  for (const route of [userRoutes, configRoutes, (await import('../../src/routes/profile.js')).profileRoutes, (await import('../../src/routes/missions.js')).missionRoutes, (await import('../../src/routes/missionIntegration.js')).missionIntegrationRoutes, (await import('../../src/routes/foundry.js')).foundryRoutes, (await import('../../src/routes/sessions.js')).sessionRoutes]) await api.register(route);
}, {
  prefix: '/api'
});
await app.register(staticFiles, {
  root: fileURLToPath(new URL('../../../frontend/dist', import.meta.url))
});
app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
await app.listen({
  host: '127.0.0.1',
  port: 55439
});
console.log('Synthetic mission browser fixture ready: http://127.0.0.1:55439');
process.on('SIGINT', async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
