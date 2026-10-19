import test from 'node:test';
test('deployable server navigation/map/movement exactly match the pure TypeScript world', async () => {
  await import('./sync-hub-world.mjs');
});
