import { mkdir, writeFile } from 'node:fs/promises';

// Generated Tiled scene; keep upstream artwork and its existing attribution.
const width = 36, height = 28, tileSize = 32;
const ground = [], furnishings = [], rugs = [], collision = [];
const wood = 1, solid = 132, stone = 161, furniture = 417, carpet = 673, board = 705;
const atlas = (first, x, y, columns = 16) => first + y * columns + x;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  ground.push(wood + [96, 99, 105, 106, 107][(x * 7 + y * 3) % 5]);
  furnishings.push(y < 3 ? wood + x % 4 + y * 8 : y === height - 1 || x === 0 || x === width - 1 ? wood + 32 : 0);
  rugs.push(0);
  collision.push(y < 3 || y === height - 1 || x === 0 || x === width - 1 ? solid : 0);
}
function tile(x, y, gid, blocked = true) {
  furnishings[y * width + x] = gid;
  collision[y * width + x] = blocked ? solid : 0;
}
function stamp(x, y, w, h, first, sx, sy, columns = 16) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tile(x + dx, y + dy, atlas(first, sx + dx, sy + dy, columns));
}
function rug(x, y, w, h) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
    rugs[(y + dy) * width + x + dx] = atlas(carpet, dx === 0 ? 0 : dx === w - 1 ? 2 : 1, dy === 0 ? 0 : dy === h - 1 ? 2 : 1, 8);
  }
}
function table(x, y) {
  stamp(x, y, 3, 3, furniture, 0, 5);
  tile(x - 1, y + 1, atlas(furniture, 3, 5));
  tile(x + 3, y + 1, atlas(furniture, 4, 5));
}
for (let x = 5; x < 25; x++) for (let y = 6; y < 8; y++) {
  tile(x, y, atlas(furniture, x === 5 ? 0 : x === 24 ? 2 : 1, 8 + y - 6));
}
for (const x of [7, 11, 19, 23]) tile(x, 8, atlas(furniture, 3, 5));
stamp(5, 2, 3, 3, stone, 12, 9);
stamp(21, 2, 3, 3, stone, 12, 9);
table(5, 11); table(12, 11); table(23, 11);
table(5, 21); table(12, 21); table(27, 21);
// Open central hall and reading nook, connected by wide passages.
rug(10, 16, 10, 4);
rug(25, 19, 7, 6);
for (let y = 18; y <= 25; y++) if (y < 20 || y > 23) tile(22, y, wood + 32);
stamp(28, 17, 3, 2, stone, 12, 9);
stamp(29, 3, 3, 3, board, 0, 0, 3);
// Visible entrance; boundaries stay solid, with no adventure warp.
tile(14, height - 1, wood + 41); tile(15, height - 1, wood + 42);
const areas = [
  { id: 'counter', name: 'Balcão da anfitriã', label: [390, 120], approach: [480, 290] },
  { id: 'tables', name: 'Mesas de convivência', label: [100, 320], approach: [320, 480] },
  { id: 'hall', name: 'Salão de encontros', label: [330, 510], approach: [480, 560] },
  { id: 'board', name: 'Mural de aventuras', label: [900, 195], approach: [976, 256] },
  { id: 'nook', name: 'Recanto dos viajantes', label: [790, 608], approach: [800, 800] },
];
const floorplan = { width, height, tileSize, collision, spawn: [480, 560], cardTable: [784, 400], boardBounds: [928, 96, 96, 96], areas };
const layer = (id, name, values) => `<layer id="${id}" name="${name}" width="${width}" height="${height}"><data encoding="csv">${values.join(',')}</data></layer>`;
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" width="${width}" height="${height}" tilewidth="32" tileheight="32" infinite="0" nextlayerid="6" nextobjectid="2">
<properties><property name="name" value="Nimrod Tavern"/><property name="license" value="Upstream tile credits retained in LICENSE.md; Nimrod noticeboard is original SVG"/></properties>
<tileset firstgid="1" source="../../graphics/tilesets/generic/ship/indoor/Indoor.tsx"/>
<tileset firstgid="129" source="../../graphics/tilesets/tonori/Collision Full.tsx"/>
<tileset firstgid="161" source="../../graphics/tilesets/tonori/indoor/Castle Indoor.tsx"/>
<tileset firstgid="417" source="../../graphics/tilesets/aemil/aurora/artis/indoor/fringe.tsx"/>
<tileset firstgid="673" source="../../graphics/tilesets/tonori/indoor/Carpet.tsx"/>
<tileset firstgid="705" source="../../graphics/tilesets/nimrod/noticeboard.tsx"/>
${layer(1, 'Ground', ground)}${layer(2, 'Carpets', rugs)}${layer(3, 'Fringe', furnishings)}${layer(4, 'Collision', collision)}
<objectgroup id="5" name="Actors"><object id="1" name="Elanore" type="Spawn" x="480" y="192"><properties>
<property name="nick" value="Anfitriã"/><property name="type" value="Npc"/>
<property name="player_script" value="../integration/TavernKeeper.gd"/>
</properties></object></objectgroup></map>`;
const destination = new URL('./game/data/maps/nimrod/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL('tavern.tmx', destination), xml);
await writeFile(new URL('floorplan.json', destination), JSON.stringify(floorplan));
// Raw maps are excluded from upstream web exports. A generated Resource makes
// the same layout available in the web pack without widening export filters.
const scripts = new URL('./game/sources/integration/', import.meta.url);
await mkdir(scripts, { recursive: true });
await writeFile(new URL('HubLayoutData.gd', scripts), `extends RefCounted\nconst DATA: Dictionary = ${JSON.stringify(floorplan)}\n`);
const artwork = new URL('./game/data/graphics/tilesets/nimrod/', import.meta.url);
await mkdir(artwork, { recursive: true });
await writeFile(new URL('noticeboard.tsx', artwork), `<?xml version="1.0" encoding="UTF-8"?><tileset version="1.10" name="Nimrod Noticeboard" tilewidth="32" tileheight="32" tilecount="9" columns="3"><image source="noticeboard.png" width="96" height="96"/></tileset>`);
await writeFile(new URL('noticeboard.svg', artwork), `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" shape-rendering="crispEdges"><path fill="#241811" d="M0 0h96v96H0z"/><path fill="#95623b" d="M4 4h88v80H4z"/><path fill="#51341f" d="M10 10h76v68H10z"/><path fill="#c59958" d="M4 4h88v4H4z"/><path fill="#f0d8a0" d="M16 18h24v34H16zM48 16h30v24H48zM44 48h28v24H44z"/><path fill="#8c6642" d="M20 28h16v2H20zM20 34h12v2H20zM52 26h22v2H52zM48 58h20v2H48zM48 64h16v2H48z"/><path fill="#983d32" d="M26 16h4v6h-4zM60 14h4v6h-4zM54 46h4v6h-4z"/><path fill="#674027" d="M12 84h8v12h-8zM76 84h8v12h-8z"/></svg>`);
