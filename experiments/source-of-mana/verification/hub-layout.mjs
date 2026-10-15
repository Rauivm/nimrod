import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const base = new URL('../game/data/maps/nimrod/', import.meta.url);
const plan = JSON.parse(await readFile(new URL('floorplan.json', base), 'utf8'));
const { width, height, collision, tileSize } = plan;
assert.equal(collision.length, width * height);
const index = point => Math.floor(point[1] / tileSize) * width + Math.floor(point[0] / tileSize);
const seen = new Set([index(plan.spawn)]), queue = [...seen];
assert.equal(collision[queue[0]], 0, 'Safe arrival must be walkable');
for (const cell of queue) {
  const x = cell % width, y = Math.floor(cell / width);
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    const next = ny * width + nx;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height && !collision[next] && !seen.has(next)) {
      seen.add(next); queue.push(next);
    }
  }
}
assert.equal(seen.size, collision.filter(cell => !cell).length, 'All circulation areas must connect');
for (const area of plan.areas) assert.ok(seen.has(index(area.approach)), `Unreachable: ${area.name}`);
for (const point of [[670, 480], [700, 480]]) assert.ok(seen.has(index(point)), 'Existing social interaction approach must stay reachable');
for (let x = 0; x < width; x++) {
  assert.ok(collision[x]); assert.ok(collision[(height - 1) * width + x]);
}
for (let y = 0; y < height; y++) {
  assert.ok(collision[y * width]); assert.ok(collision[y * width + width - 1]);
}
const xml = await readFile(new URL('tavern.tmx', base), 'utf8');
for (const [, source] of xml.matchAll(/<tileset[^>]+source="([^"]+)"/g)) await access(new URL(source, base));
assert.doesNotMatch(xml, /type="(?:Warp|Mob)"/);
console.log(`HUB_LAYOUT_PASS: ${width}x${height}, ${seen.size} connected walkable cells, ${plan.areas.length} reachable social areas, solid boundary, valid tilesets`);
