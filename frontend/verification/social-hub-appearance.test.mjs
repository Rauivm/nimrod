import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const urls = new Map();
async function load(relative) {
  if (urls.has(relative)) return import(urls.get(relative));
  const source = await readFile(new URL(`../src/features/social-hub/${relative}.ts`, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  if (relative === 'appearance/resolveAppearance') {
    await load('appearance/classPresets');
    outputText = outputText.replace("from './classPresets'", `from '${urls.get('appearance/classPresets')}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  urls.set(relative, url); return import(url);
}
const { classPresets, travelerPreset } = await load('appearance/classPresets');
const { resolveAppearance } = await load('appearance/resolveAppearance');
const { avatarPose, facingFromDirection } = await load('appearance/avatarAnimation');
const { avatarSheets } = await load('assets/avatarFrames');

test('the twelve requested classes resolve in Portuguese, English, accents and localized gender variants', () => {
  const pairs = [['Guerreiro', 'Fighter', 'fighter'], ['Paladina', 'Paladin', 'paladin'], ['Mago', 'Wizard', 'wizard'],
    ['Feiticeira', 'Sorcerer', 'sorcerer'], ['Bruxa', 'Warlock', 'warlock'], ['Ladina', 'Rogue', 'rogue'],
    ['Patrulheira', 'Ranger', 'ranger'], ['CLÉRIGO', 'Cleric', 'cleric'], ['Druida', 'Druid', 'druid'],
    ['Barda', 'Bard', 'bard'], ['BÁRBARO', 'Barbarian', 'barbarian'], ['Monja', 'Monk', 'monk']];
  for (const [pt, en, id] of pairs) for (const text of [pt, en]) {
    const result = resolveAppearance(text);
    assert.equal(result.preset.id, id, text); assert.equal(result.fallback, false);
  }
  assert.equal(classPresets.length, 12);
});

test('unknown or missing classes get a real neutral sprite, without matching substrings or inventing a class', () => {
  for (const value of [null, '', '  ', 'Místico', 'Artífice', 'Magocrata', 'Druidismo']) {
    const result = resolveAppearance(value);
    assert.equal(result.fallback, true); assert.equal(result.preset.id, 'traveler');
    assert.equal(result.matchedClasses.length, 0);
  }
});

test('multiclass respects text order and word boundaries rather than guessing unavailable levels', () => {
  assert.equal(resolveAppearance('Ladino 2 / Mago 8').preset.id, 'rogue');
  assert.equal(resolveAppearance('Wizard, Fighter').preset.id, 'wizard');
  assert.deepEqual(resolveAppearance('Monge + Clérigo + Monge').matchedClasses.map(p => p.id), ['monk', 'cleric']);
  assert.equal(resolveAppearance('Guerreiro (Mestre de Batalha)').preset.id, 'fighter');
});

test('data extensions support another class and explicit parent-scoped subclass variants', () => {
  const custom = { ...travelerPreset, id: 'custom', label: 'Classe de teste', aliases: ['classe de teste'] };
  assert.equal(resolveAppearance('Classe de teste', [...classPresets, custom]).preset.id, 'custom');
  const fighter = classPresets.find(p => p.id === 'fighter');
  const variant = { ...fighter, id: 'variant', label: 'Variante de teste' };
  const rules = [{ parentId: 'fighter', aliases: ['cavaleiro arcano'], preset: variant }];
  assert.equal(resolveAppearance('Guerreiro (Cavaleiro Arcano)', classPresets, rules).preset.id, 'variant');
  assert.equal(resolveAppearance('Ladino, Guerreiro (Cavaleiro Arcano)', classPresets, rules).preset.id, 'rogue');
});

test('all current recipes declare illustrative equipment separately from identity and inventory', () => {
  for (const preset of [...classPresets, travelerPreset]) {
    const result = resolveAppearance(preset.aliases[0] ?? null);
    assert.equal(result.equipmentSource, 'visual-preset');
    assert.deepEqual(result.layers.map(layer => layer.slot), ['body']);
    assert.ok(result.preset.visualEquipment.length);
    assert.equal('inventory' in result, false); assert.equal('equippedItems' in result, false);
  }
});

test('isometric grid directions select the four proper facings and keep a stopped actor oriented', () => {
  for (const [direction, facing] of [[{ x: 1, y: 0 }, 'se'], [{ x: 0, y: 1 }, 'sw'], [{ x: 0, y: -1 }, 'ne'], [{ x: -1, y: 0 }, 'nw']]) {
    assert.equal(facingFromDirection(direction), facing);
  }
  assert.equal(facingFromDirection({ x: 0, y: 0 }, 'nw'), 'nw');
  assert.equal(facingFromDirection({ x: NaN, y: 1 }, 'sw'), 'sw');
});

test('walking uses alternating authored strides, idle uses its own pose, and reduced motion freezes limbs', () => {
  assert.deepEqual([0, 0.125, 0.25, 0.375].map(t => avatarPose('se', true, t, false).frame), [0, 1, 2, 1]);
  for (const facing of ['se', 'sw', 'ne', 'nw']) {
    assert.equal(avatarPose(facing, false, 99, false).frame, 1);
    assert.equal(avatarPose(facing, true, 0, true).frame, 1);
    assert.equal(avatarPose(facing, true, 0, false).view, facing.startsWith('s') ? 'front' : 'back');
    assert.equal(avatarPose(facing, true, 0, false).mirrored, facing.endsWith('w'));
  }
});

test('every character clip is backed by six distinct, valid frames inside original RGBA PNGs', async () => {
  let total = 0;
  for (const [key, sheet] of Object.entries(avatarSheets)) {
    const image = await readFile(new URL(`../public/social-hub/${sheet.file}`, import.meta.url));
    assert.equal(image.readUInt32BE(16), sheet.width, key); assert.equal(image.readUInt32BE(20), sheet.height, key);
    assert.equal(image[25], 6, `${key} must retain RGBA transparency`);
    for (const clip of sheet.presets) {
      assert.equal(clip.front.length, 3); assert.equal(clip.back.length, 3);
      const frames = [...clip.front, ...clip.back];
      assert.equal(new Set(frames.map(frame => frame.rect.join(','))).size, 6);
      for (const frame of frames) {
        const [x, y, w, h] = frame.rect;
        assert.ok(x >= 0 && y >= 0 && w > 50 && h > 100 && x + w <= sheet.width && y + h <= sheet.height);
        assert.ok(frame.anchor.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
        assert.ok(clip.nativeHeight >= h); total++;
      }
    }
  }
  assert.equal(total, 78);
  for (const preset of [...classPresets, travelerPreset]) assert.ok(avatarSheets[preset.sheet].presets[preset.row]);
});
