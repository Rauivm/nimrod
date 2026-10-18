import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function pure(relative) {
  const source = await readFile(new URL(`../src/features/social-hub/${relative}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { Navigation } = await pure('world/Navigation');
const { ExplorerMovement } = await pure('world/ExplorerMovement');
const { tavernMap: map } = await pure('world/tavernMap');
const obstacle = (x, y, width, height) => ({ position: { x, y }, footprint: { width, height } });
const close = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

test('navigation rejects nonfinite coordinates, walls, furniture and clearance too small for the explorer', () => {
  const nav = new Navigation({ columns: 8, rows: 8, props: [obstacle(4, 4, 2, 2)] });
  for (const point of [{ x: NaN, y: 1 }, { x: Infinity, y: 1 }, { x: -1, y: 3 }, { x: 0.1, y: 3 }, { x: 7.9, y: 3 }, { x: 4, y: 4 }, { x: 2.9, y: 4 }]) {
    assert.equal(nav.isWalkable(point), false);
    assert.equal(nav.findPath({ x: 1, y: 1 }, point), null);
  }
  assert.equal(nav.isWalkable({ x: 2.7, y: 4 }), true);
});

test('a continuous segment cannot tunnel through furniture or cut an inflated diagonal corner', () => {
  const nav = new Navigation({ columns: 8, rows: 8, props: [obstacle(4, 4, 2, 2)] });
  assert.equal(nav.canTraverse({ x: 1, y: 4 }, { x: 7, y: 4 }), false);
  assert.equal(nav.canTraverse({ x: 2.7, y: 3.2 }, { x: 3.2, y: 2.7 }), false);
  assert.equal(nav.canTraverse({ x: 2, y: 3 }, { x: 3, y: 2 }), true);
});

test('A* routes around a long obstacle with collision-safe segments and an exact endpoint', () => {
  const nav = new Navigation({ columns: 8, rows: 8, props: [obstacle(4, 4, 1, 5)] });
  const from = { x: 1.1, y: 4.1 }, to = { x: 7.1, y: 4.1 };
  const route = nav.findPath(from, to);
  assert.ok(route && route.length > 1);
  let last = from;
  for (const point of route) { assert.ok(nav.canTraverse(last, point)); last = point; }
  assert.deepEqual(last, to);
});

test('disconnected rooms return no route rather than teleporting across a wall', () => {
  const nav = new Navigation({ columns: 8, rows: 8, props: [obstacle(4, 4, 1, 8)] });
  assert.equal(nav.findPath({ x: 1, y: 4 }, { x: 7, y: 4 }), null);
});

test('the wall portal and every actual interaction are reachable with runtime clearance and movement', () => {
  const nav = new Navigation(map);
  const portal = map.props.find(prop => prop.id === 'tavern-entrance');
  assert.ok(portal.position.y < 1.5 && portal.position.x > 3 && portal.position.x < 6);
  for (const point of map.points) {
    const movement = new ExplorerMovement(nav, map.spawn);
    assert.ok(movement.walkTo(point.position), point.id);
    for (let frame = 0; frame < 3600 && movement.pending; frame++) {
      const previous = movement.position;
      movement.update(1 / 60);
      assert.ok(nav.canTraverse(previous, movement.position), `unsafe step toward ${point.id}`);
      assert.ok(nav.isWalkable(movement.position), point.id);
    }
    assert.ok(close(movement.position, point.position), `could not arrive at ${point.id}`);
    assert.equal(movement.pending, false);
    assert.equal(movement.moving, false, 'Arrival must be idle even if reduced motion stops the next ticker frame');
  }
});

test('keyboard movement normalizes diagonals, bounds long frames and stops at walls/furniture', () => {
  const nav = new Navigation({ columns: 8, rows: 8, props: [obstacle(4, 4, 2, 2)] });
  const horizontal = new ExplorerMovement(nav, { x: 1, y: 1 });
  const diagonal = new ExplorerMovement(nav, { x: 1, y: 1 });
  horizontal.setInput({ x: 1, y: 0 }); diagonal.setInput({ x: 1, y: 1 });
  horizontal.update(0.05); diagonal.update(100);
  assert.ok(Math.abs(Math.hypot(diagonal.position.x - 1, diagonal.position.y - 1) - (horizontal.position.x - 1)) < 1e-8);
  const blocked = new ExplorerMovement(nav, { x: 2, y: 4 });
  blocked.setInput({ x: 1, y: 0 });
  for (let frame = 0; frame < 1000; frame++) blocked.update(0.05);
  assert.ok(blocked.position.x < 3 - nav.radius && blocked.position.x > 2.7);
  blocked.setInput({ x: -1, y: 0 });
  for (let frame = 0; frame < 1000; frame++) blocked.update(0.05);
  assert.ok(blocked.position.x >= nav.radius && blocked.position.x < 0.23);
});

test('keyboard input cancels a click route, retargeting replaces it, and stop cannot resume movement', () => {
  const nav = new Navigation({ columns: 8, rows: 8, props: [] });
  const movement = new ExplorerMovement(nav, { x: 2, y: 2 });
  assert.ok(movement.walkTo({ x: 6, y: 6 }));
  movement.setInput({ x: -1, y: 0 }); movement.update(0.05);
  assert.equal(movement.pending, false); assert.ok(movement.position.x < 2);
  assert.ok(movement.walkTo({ x: 2, y: 3 }));
  for (let frame = 0; frame < 100; frame++) movement.update(0.05);
  assert.ok(close(movement.position, { x: 2, y: 3 }));
  movement.setInput({ x: 1, y: 1 }); movement.stop();
  const position = { ...movement.position };
  for (let frame = 0; frame < 100; frame++) movement.update(0.05);
  assert.deepEqual(movement.position, position); assert.equal(movement.moving, false);
});
