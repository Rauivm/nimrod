import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadPureModule(relative) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { project, unproject, depthAt, fitCamera } = await loadPureModule('../src/features/social-hub/world/isometric.ts');
const { tavernMap: map } = await loadPureModule('../src/features/social-hub/world/tavernMap.ts');
const { atlasFrames } = await loadPureModule('../src/features/social-hub/assets/atlasFrames.ts');

test('isometric projection preserves 2:1 axes and round trips fractional/negative positions', () => {
  assert.deepEqual(project({ x: 1, y: 0 }, map), { x: 48, y: 24 });
  assert.deepEqual(project({ x: 0, y: 1 }, map), { x: -48, y: 24 });
  for (const original of [{ x: 0, y: 0 }, { x: 1.25, y: 9.75 }, { x: -2, y: 3.7 }, { x: 14, y: 12 }]) {
    const restored = unproject(project(original, map), map);
    assert.ok(Math.abs(restored.x - original.x) < 1e-10);
    assert.ok(Math.abs(restored.y - original.y) < 1e-10);
  }
});

test('camera contains tall and wide map bounds on desktop and mobile without distorting scale', () => {
  const bounds = { x: -616, y: -180, width: 1328, height: 862 };
  for (const viewport of [{ x: 1120, y: 700 }, { x: 358, y: 380 }, { x: 280, y: 720 }]) {
    const camera = fitCamera(bounds, viewport, 1, 8);
    const left = bounds.x * camera.scale + camera.x, top = bounds.y * camera.scale + camera.y;
    const right = left + bounds.width * camera.scale, bottom = top + bounds.height * camera.scale;
    assert.ok(left >= 8 - 1e-8 && top >= 8 - 1e-8);
    assert.ok(right <= viewport.x - 8 + 1e-8 && bottom <= viewport.y - 8 + 1e-8);
  }
});

test('depth order uses the projected ground position for every prop kind', () => {
  const ordered = [...map.props].sort((a, b) => depthAt(a.position) - depthAt(b.position));
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(project(ordered[index].position, map).y >= project(ordered[index - 1].position, map).y);
  }
});

test('the complete scene has unique IDs, five independent dining tables, fifteen chairs and required areas', () => {
  assert.equal(new Set(map.props.map(prop => prop.id)).size, map.props.length);
  assert.equal(map.props.filter(prop => prop.kind === 'table').length, 5);
  assert.equal(map.props.filter(prop => prop.kind === 'chair').length, 15);
  for (const kind of ['counter', 'shelf', 'fireplace', 'stage', 'board', 'arch', 'barrels']) {
    assert.ok(map.props.some(prop => prop.kind === kind));
  }
  for (const prop of map.props) {
    assert.ok(prop.position.x - prop.footprint.width / 2 >= 0, prop.id);
    assert.ok(prop.position.x + prop.footprint.width / 2 <= map.columns, prop.id);
    assert.ok(prop.position.y - prop.footprint.height / 2 >= 0, prop.id);
    assert.ok(prop.position.y + prop.footprint.height / 2 <= map.rows, prop.id);
    assert.ok(atlasFrames[prop.kind], prop.kind);
  }
});

test('sprite frames/hulls stay within the actual RGBA atlas, preserving separately usable props', async () => {
  const png = await readFile(new URL('../public/social-hub/tavern-props-v1.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 1254);
  assert.equal(png.readUInt32BE(20), 1254);
  assert.equal(png[25], 6, 'Atlas must retain RGBA rather than a baked background');
  for (const frame of Object.values(atlasFrames)) {
    const [x, y, width, height] = frame.frame;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
    assert.ok(x + width <= 1254 && y + height <= 1254);
    assert.ok(frame.anchor.every(value => value >= 0 && value <= 1));
    frame.hull?.forEach((value, index) => assert.ok(value >= 0 && value <= (index % 2 ? height : width)));
  }
});

test('designer footprints reserve a connected route from arrival to all future interaction approaches', () => {
  // Design validation only: this does not install a runtime collision/pathfinding solver.
  const step = 0.25, width = map.columns / step, height = map.rows / step;
  const blocked = point => map.props.some(prop => Math.abs(point.x - prop.position.x) < prop.footprint.width / 2
    && Math.abs(point.y - prop.position.y) < prop.footprint.height / 2);
  const cell = point => Math.floor(point.y / step) * width + Math.floor(point.x / step);
  assert.equal(blocked(map.spawn), false);
  const seen = new Set([cell(map.spawn)]), queue = [...seen];
  for (const current of queue) {
    const x = current % width, y = Math.floor(current / width);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const index = ny * width + nx;
      if (seen.has(index) || blocked({ x: (nx + 0.5) * step, y: (ny + 0.5) * step })) continue;
      seen.add(index); queue.push(index);
    }
  }
  for (const point of map.points) {
    assert.ok(map.props.some(prop => prop.id === point.target));
    assert.equal(blocked(point.position), false, `${point.id} approach intersects furniture`);
    assert.ok(seen.has(cell(point.position)), `${point.id} is unreachable in the floorplan`);
  }
});
