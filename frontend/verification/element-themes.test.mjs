import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ELEMENT, ELEMENT_THEMES, elementStorageKey, normalizeElement, readElementPreference, saveElementPreference } from '../src/config/elementThemes.js';

test('only catalog themes are accepted, including a stable institutional default', () => {
  assert.equal(ELEMENT_THEMES.length, 7);
  assert.equal(new Set(ELEMENT_THEMES.map(theme => theme.id)).size, 7);
  for (const theme of ELEMENT_THEMES) assert.equal(normalizeElement(theme.id), theme.id);
  for (const value of [undefined, null, '<script>', 'FIRE', '__proto__', {}]) assert.equal(normalizeElement(value), DEFAULT_ELEMENT);
});

test('preferences are scoped per account, with a separate guest key', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(saveElementPreference(storage, 'player-a', 'water'), true);
  assert.equal(saveElementPreference(storage, 'player-b', 'shadow'), true);
  assert.equal(readElementPreference(storage, 'player-a'), 'water');
  assert.equal(readElementPreference(storage, 'player-b'), 'shadow');
  assert.equal(readElementPreference(storage, null), DEFAULT_ELEMENT);
  assert.notEqual(elementStorageKey('player-a'), elementStorageKey(null));
});

test('unavailable storage and invalid saved values fall back without exceptions', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.equal(readElementPreference(blocked, 'player'), DEFAULT_ELEMENT);
  assert.equal(saveElementPreference(blocked, 'player', 'fire'), false);
  assert.equal(readElementPreference({ getItem: () => 'invalid' }, 'player'), DEFAULT_ELEMENT);
  let writes = 0;
  assert.equal(saveElementPreference({ setItem() { writes++; } }, 'player', 'invalid'), false);
  assert.equal(writes, 0);
});
