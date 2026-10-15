import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
process.env.DATABASE_URL = 'postgres://mana_test:local_test_only@localhost:55436/mana_integration_test';
process.env.MANA_BRIDGE_SECRET = randomBytes(32).toString('hex');
process.env.MANA_PUBLIC_URL = 'http://localhost:5185/';
process.env.NODE_ENV = 'test';
process.env.DEV_USER_EMAIL = '';
const { query, pool } = await import('../../../backend/src/db/index.js');
const { cfAuthMiddleware } = await import('../../../backend/src/middleware/auth.js');
const { manaBridgeRoutes, manaPlayerRoutes } = await import('../../../backend/src/routes/mana.js');
const { requireManaServer } = await import('../../../backend/src/services/manaAccess.js');
const app = require('fastify')();
const compose = ['compose', '-f', 'docker-compose.mana.yml', '-f', 'docker-compose.mana.verify.yml', '--profile', 'verify'];
function docker(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...compose, ...args], { cwd: root, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}
const users = [0, 1].map(i => ({ id: randomUUID(), email: `lobby-${i}@example.invalid`, name: `Lobby Fixture ${i}` }));
const characters = [0, 1].map(i => ({ id: randomUUID(), name: `Lobby Character ${i}` }));
const issue = async i => {
  const response = await app.inject({ method: 'POST', url: '/mana/launch', headers: { 'x-dev-user': users[i].email },
    payload: { character_id: characters[i].id } });
  assert.equal(response.statusCode, 200, response.body);
  return new URL(response.json().url).hash.slice(8);
};
const bridge = payload => app.inject({ method: 'POST', url: '/mana/redeem',
  headers: { authorization: `Bearer ${process.env.MANA_BRIDGE_SECRET}` }, payload });
const client = async (i, role) => {
  const token = await issue(i);
  let output;
  try { output = await docker(['run', '--rm', '--no-deps', '-e', 'MANA_SERVER_ADDRESS=mana-integration-server',
    '-e', `MANA_SMOKE_TOKEN=${token}`, '-e', `LOBBY_TEST_ROLE=${role}`, '-e', `LOBBY_TEST_NAME=${characters[i].name}`,
    '-e', 'LOBBY_TEST_RENAMED=Renamed Lobby Hero',
    'mana-smoke', 'godot', '--headless', '--path', '/opt/mana', 'res://verification/LobbyClient.tscn']); }
  catch (err) { await writeFile(new URL(`../artifacts/lobby-client-${role}.log`, import.meta.url), err.message); throw err; }
  await writeFile(new URL(`../artifacts/lobby-client-${role}.log`, import.meta.url), output);
  assert.doesNotMatch(output, /SCRIPT ERROR|MANA_SMOKE_FAIL/);
  console.log(output.split('\n').filter(line => /LOBBY_.*PASS/.test(line)).join('\n'));
  assert.equal((await bridge({ token })).statusCode, 401);
  return output;
};
try {
  await docker(['up', '-d', '--wait', 'mana-test-db']);
  await query(`CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE, name TEXT, display_name TEXT, role TEXT);
    CREATE TABLE player_characters (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), name TEXT,
    active BOOLEAN DEFAULT TRUE, retired BOOLEAN DEFAULT FALSE, dead BOOLEAN DEFAULT FALSE)`);
  for (const name of ['031_side_quests_mvp.sql', '032_mana_launch_tickets.sql', '033_mana_lobby_access.sql']) {
    await query(await readFile(new URL('../../../backend/migrations/' + name, import.meta.url), 'utf8'));
  }
  for (let i = 0; i < 2; i++) {
    await query('INSERT INTO users (id, email, name, role) VALUES ($1,$2,$3,$4)', [users[i].id, users[i].email, users[i].name, 'PLAYER']);
    await query('INSERT INTO player_characters (id,user_id,name) VALUES ($1,$2,$3)', [characters[i].id, users[i].id, characters[i].name]);
  }
  await app.register(manaBridgeRoutes);
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'POST' && ['/mana/redeem', '/mana/authorize'].includes(req.url)) return requireManaServer(req);
    return cfAuthMiddleware(req, reply);
  });
  await app.register(manaPlayerRoutes);
  await app.listen({ port: 5186, host: '0.0.0.0' });
  assert.equal((await app.inject({ method: 'POST', url: '/mana/launch', headers: { 'x-dev-user': users[0].email },
    payload: { character_id: characters[1].id } })).statusCode, 403);
  assert.equal((await bridge({ token: '0'.repeat(64) })).statusCode, 401);
  const expired = await issue(0);
  await query("UPDATE mana_launch_tickets SET expires_at = NOW() - INTERVAL '1 minute'");
  assert.equal((await bridge({ token: expired })).statusCode, 401);
  await docker(['up', '-d', '--wait', 'mana-integration-server']);
  if (process.env.MANA_HUB_WEB_ONLY === 'true') {
    await docker(['up', '-d', '--wait', 'mana-integration-web']);
    const { verifyHubWeb } = await import('./hub-web.mjs');
    await verifyHubWeb(issue);
  } else {
  const unit = await docker(['run', '--rm', '--no-deps', 'mana-smoke', 'godot', '--headless', '--path', '/opt/mana', 'res://verification/CardTableTest.tscn']);
  assert.match(unit, /CARD_TABLE_PASS/);
  assert.doesNotMatch(unit, /SCRIPT ERROR/);
  console.log('CARD_TABLE_PASS: server rules verified');
  const result = await Promise.allSettled([client(0, 'a'), client(1, 'b')]);
  for (const outcome of result) assert.equal(outcome.status, 'fulfilled', outcome.reason?.message);
  const gameA = result[0].value.match(/game=(\d+) cards=([^\r\n]+) winner=(\d+)/);
  const gameB = result[1].value.match(/game=(\d+) cards=([^\r\n]+) winner=(\d+)/);
  assert.ok(gameA && gameB);
  assert.deepEqual(gameA.slice(1), gameB.slice(1));
  assert.match(result[0].value, /LOBBY_NPC_PASS/);
  const original = await client(0, 'identity');
  const live = client(0, 'live');
  await new Promise(resolve => setTimeout(resolve, 8000));
  characters[0].name = 'Renamed Lobby Hero';
  await query('UPDATE player_characters SET name = $1 WHERE id = $2', [characters[0].name, characters[0].id]);
  const liveResult = await live;
  assert.match(liveResult, /LOBBY_LIVE_RENAME_PASS/);
  assert.equal(original.match(/game_id=(\d+)/)[1], liveResult.match(/game_id=(\d+)/)[1]);
  const renamed = await client(0, 'identity');
  assert.equal(original.match(/game_id=(\d+)/)[1], renamed.match(/game_id=(\d+)/)[1]);
  if (process.env.MANA_HUB_WEB_TEST === 'true') {
    await docker(['up', '-d', '--wait', 'mana-integration-web']);
    const { verifyHubWeb } = await import('./hub-web.mjs');
    await verifyHubWeb(issue);
  }
  const token = await issue(0);
  const concurrent = await Promise.all([bridge({ token }), bridge({ token })]);
  assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 401]);
  const grant = concurrent.find(r => r.statusCode === 200).json().grant_id;
  await query('UPDATE player_characters SET user_id = $1 WHERE id = $2', [users[1].id, characters[0].id]);
  assert.equal((await app.inject({ method: 'POST', url: '/mana/authorize', headers: { authorization: `Bearer ${process.env.MANA_BRIDGE_SECRET}` },
    payload: { grant_id: grant } })).statusCode, 403);
  const audit = (await query("SELECT new_state FROM activity_logs WHERE event_type = 'mana.lobby.authorized' AND user_id = $1 ORDER BY created_at", [users[0].id])).rows;
  assert.equal(audit[0].new_state.character_name, 'Lobby Character 0');
  console.log('LOBBY_INTEGRATION_PASS: real auth middleware, two UUID-linked characters, movement/sprites/chat, cards, NPC drink, disconnect cleanup, rename/reconnect, replay/expiry/ownership, historical audit');
  }
} finally {
  await app.close();
  await pool.end();
  await docker(['stop', 'mana-test-db', 'mana-integration-server', 'mana-integration-web']);
}
