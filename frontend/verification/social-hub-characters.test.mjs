import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modelUrl = dataUrl(compile(await readFile(new URL('../src/features/social-hub/characters/hubCharacters.ts', import.meta.url), 'utf8')));
const { readHubCharacters, characterImageUrl } = await import(modelUrl);
const rosterSource = compile(await readFile(new URL('../src/features/social-hub/characters/CharacterRoster.ts', import.meta.url), 'utf8'));
const { CharacterRoster } = await import(dataUrl(rosterSource.replace("from './hubCharacters'", `from '${modelUrl}'`)));
const account = 'owner-fixture';
const character = (id = 'one', overrides = {}) => ({ id, name: `Character ${id}`, userId: account,
  active: true, retired: false, dead: false, level: 7, classe: 'Mago', foundryActorId: 'actor-fixture', ...overrides });
const settled = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('only the current owner’s explicitly active, living, nonretired characters are eligible', () => {
  const rows = [character('yes'), character('foreign', { userId: 'another' }), character('unlinked', { userId: null }),
    character('dead', { dead: true }), character('retired', { retired: true }), character('inactive', { active: false }),
    character('unknown-dead', { dead: undefined }), character('unknown-owner', { userId: undefined }), character('string-flag', { active: 'true' }), null, {}];
  assert.deepEqual(readHubCharacters(rows, account).map(c => c.id), ['yes']);
  assert.deepEqual(readHubCharacters(rows, ''), []);
});

test('malformed contracts and ambiguous duplicate identifiers cannot invent an eligible identity', () => {
  assert.throws(() => readHubCharacters({ items: [] }, account), /incompatível/);
  assert.deepEqual(readHubCharacters([character(), character()], account), []);
  assert.deepEqual(readHubCharacters([character('blank', { name: '  ' })], account), []);
});

test('missing class, level, portrait, sync or Actor data remains absent; manually registered characters stay supported', () => {
  const [result] = readHubCharacters([character('manual', { level: null, classe: '', race: null, foundryActorId: null,
    tokenImg: '', portraitImg: null, lastSyncedAt: 'invalid' })], account);
  assert.equal(result.id, 'manual'); assert.equal(result.level, null); assert.equal(result.classe, null);
  assert.equal(result.foundryActorId, null); assert.equal(result.tokenImg, null); assert.equal(result.lastSyncedAt, null);
  const [actual] = readHubCharacters([character('real', { race: 'Elfo', lastSyncedAt: '2026-10-17T12:00:00Z' })], account);
  assert.equal(actual.level, 7); assert.equal(actual.classe, 'Mago'); assert.equal(actual.race, 'Elfo');
  assert.equal(actual.lastSyncedAt, '2026-10-17T12:00:00Z');
  assert.equal('equipment' in actual, false); assert.equal('inventory' in actual, false);
});

test('portraits reuse the local Foundry proxy or uploads and cannot fetch an arbitrary external host', () => {
  assert.equal(characterImageUrl('/uploads/token.webp'), '/uploads/token.webp');
  assert.equal(characterImageUrl('worlds/test/token.webp'), '/api/foundry/assets?path=worlds%2Ftest%2Ftoken.webp');
  assert.equal(characterImageUrl('https://foundry.example.test/worlds/a.webp?t=discard'), '/api/foundry/assets?path=%2Fworlds%2Fa.webp');
  for (const bad of [null, 'javascript:alert(1)', 'data:image/png;base64,bad', '//external.test/a', 'a\\b', '../secret', '/%2e%2e/secret', 'https://u:p@example.test/a']) assert.equal(characterImageUrl(bad), null);
});

test('a single eligible character is automatic; multiple characters require an explicit valid choice', async () => {
  let rows = [character()]; const store = new CharacterRoster(account, async () => rows, () => {});
  await store.refresh(); assert.equal(store.state.selectedId, 'one');
  rows = [character('two'), character('three')]; await store.refresh();
  assert.equal(store.state.selectedId, null);
  store.select('three'); assert.equal(store.state.selectedId, 'three');
  store.select('foreign'); assert.equal(store.state.selectedId, null);
  store.dispose();
});

test('revalidation hides the scene identity, keeps a still-authorized choice and removes revoked/dead selections', async () => {
  let rows = [character('one'), character('two'), character('three')];
  const pending = deferred(); let delay = false;
  const store = new CharacterRoster(account, () => delay ? pending.promise : Promise.resolve(rows), () => {});
  await store.refresh(); store.select('two');
  delay = true; const refreshing = store.refresh();
  assert.equal(store.state.status, 'loading'); assert.equal(store.state.selectedId, null); assert.deepEqual(store.state.characters, []);
  pending.resolve(rows); await refreshing; assert.equal(store.state.selectedId, 'two');
  delay = false; rows = [character('one'), character('two', { dead: true }), character('three')];
  await store.refresh(); assert.equal(store.state.selectedId, null); assert.equal(store.state.characters.length, 2);
  store.dispose();
});

test('load errors and contract failures clear identities and allow retry with no fallback character', async () => {
  let load = async () => [character()];
  const store = new CharacterRoster(account, () => load(), () => {});
  await store.refresh(); assert.equal(store.state.selectedId, 'one');
  load = async () => { throw new Error('Forbidden'); }; await store.refresh();
  assert.equal(store.state.status, 'error'); assert.equal(store.state.selectedId, null); assert.deepEqual(store.state.characters, []);
  load = async () => ({ malformed: true }); await store.refresh(); assert.equal(store.state.status, 'error');
  load = async () => []; await store.refresh(); assert.equal(store.state.status, 'ready'); assert.equal(store.state.selectedId, null);
  store.dispose();
});

test('concurrent invalidations coalesce, discard an outdated reply and load the canonical roster again', async () => {
  const first = deferred(), second = deferred(); let calls = 0; const published = [];
  const store = new CharacterRoster(account, () => (++calls === 1 ? first.promise : second.promise), state => published.push(state));
  const loading = store.refresh(); store.invalidate(); store.invalidate();
  assert.equal(calls, 1); first.resolve([character('stale')]); await loading; await settled();
  assert.equal(calls, 2); assert.equal(store.state.status, 'loading');
  assert.equal(published.some(state => state.selectedId === 'stale'), false);
  second.resolve([character('current')]); await settled(); assert.equal(store.state.selectedId, 'current');
  store.dispose();
});

test('a disposed/previous-account request cannot publish after the next account starts or restart queued work', async () => {
  const old = deferred(), oldStates = [], newStates = []; let calls = 0;
  const previous = new CharacterRoster(account, () => { calls++; return old.promise; }, state => oldStates.push(state));
  const loading = previous.refresh(); previous.invalidate(); previous.dispose();
  const next = new CharacterRoster('new-owner', async () => [character('new', { userId: 'new-owner' })], state => newStates.push(state));
  await next.refresh(); old.resolve([character('old')]); await loading; await settled();
  assert.equal(oldStates.length, 1); assert.equal(calls, 1); assert.equal(next.state.selectedId, 'new');
  assert.equal(newStates.some(state => state.selectedId === 'old'), false); next.dispose();
});
