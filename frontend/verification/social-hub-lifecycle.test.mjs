import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the real TS lifecycle without WebGL, a DOM library or another test runner.
const source = await readFile(new URL('../src/features/social-hub/scene/mountHubScene.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { mountHubScene } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const settled = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const children = new Set(), states = [], sizes = [];
  let destroyed = 0, disconnected = 0, observerCallback;
  let bounds = { width: 640, height: 400 };
  const canvas = new EventTarget();
  canvas.remove = () => { canvas.parent?.delete(canvas); canvas.parent = null; };
  const host = {
    appendChild: element => { element.remove(); children.add(element); element.parent = children; },
    getBoundingClientRect: () => bounds,
  };
  const scene = { canvas, resize: (w, h) => sizes.push([w, h]), destroy: () => { destroyed++; } };
  const observe = (_host, resize) => { observerCallback = resize; return () => { disconnected++; }; };
  return {
    host, scene, children, states, sizes, observe,
    report: state => states.push(state),
    resize: (width, height) => { bounds = { width, height }; observerCallback(); },
    get destroyed() { return destroyed; },
    get disconnected() { return disconnected; },
  };
}

test('scene mounts, resizes to its container and releases resources exactly once', async () => {
  const f = fixture();
  const dispose = mountHubScene(f.host, async () => f.scene, f.report, f.observe);
  await settled();
  assert.deepEqual(f.states, ['loading', 'ready']);
  assert.equal(f.children.size, 1);
  assert.deepEqual(f.sizes, [[640, 400]]);
  f.resize(320, 500);
  assert.deepEqual(f.sizes.at(-1), [320, 500]);
  dispose(); dispose();
  f.resize(900, 400);
  f.scene.canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(f.sizes.length, 2, 'Late resize callbacks must be ignored');
  assert.equal(f.children.size, 0);
  assert.equal(f.destroyed, 1);
  assert.equal(f.disconnected, 1);
  assert.deepEqual(f.states, ['loading', 'ready']);
});

test('unmount before async init finishes destroys the late scene without mounting or reporting ready', async () => {
  const f = fixture(), init = deferred();
  const dispose = mountHubScene(f.host, () => init.promise, f.report, f.observe);
  dispose();
  init.resolve(f.scene);
  await settled();
  assert.equal(f.children.size, 0);
  assert.equal(f.destroyed, 1);
  assert.equal(f.disconnected, 0);
  assert.deepEqual(f.states, ['loading']);
});

test('StrictMode replacement survives an earlier scene finishing initialization later', async () => {
  const first = fixture(), second = fixture(), init = deferred();
  const disposeFirst = mountHubScene(first.host, () => init.promise, first.report, first.observe);
  disposeFirst();
  const disposeSecond = mountHubScene(first.host, async () => second.scene, second.report, second.observe);
  await settled();
  init.resolve(first.scene);
  await settled();
  assert.equal(first.destroyed, 1);
  assert.equal(first.children.has(second.scene.canvas), true);
  assert.equal(second.destroyed, 0);
  disposeSecond();
  assert.equal(second.destroyed, 1);
  assert.equal(first.children.size, 0);
});

test('rejected initialization reports a recoverable error and leaves no canvas', async () => {
  const f = fixture();
  const dispose = mountHubScene(f.host, async () => { throw Error('WebGL unavailable'); }, f.report, f.observe);
  await settled();
  assert.deepEqual(f.states, ['loading', 'error']);
  assert.equal(f.children.size, 0);
  dispose();
});

test('a synchronous factory failure is also handled', async () => {
  const f = fixture();
  mountHubScene(f.host, () => { throw Error('import unavailable'); }, f.report, f.observe);
  await settled();
  assert.deepEqual(f.states, ['loading', 'error']);
});

test('an initialization failure after unmount cannot update React state', async () => {
  const f = fixture(), init = deferred();
  const dispose = mountHubScene(f.host, () => init.promise, f.report, f.observe);
  dispose();
  init.reject(Error('late failure'));
  await settled();
  assert.deepEqual(f.states, ['loading']);
});

test('observer setup failure releases an already created scene', async () => {
  const f = fixture();
  mountHubScene(f.host, async () => f.scene, f.report, () => { throw Error('observer unavailable'); });
  await settled();
  assert.deepEqual(f.states, ['loading', 'error']);
  assert.equal(f.children.size, 0);
  assert.equal(f.destroyed, 1);
});

test('context loss releases the scene and observer and exposes a retryable error', async () => {
  const f = fixture();
  const dispose = mountHubScene(f.host, async () => f.scene, f.report, f.observe);
  await settled();
  f.scene.canvas.dispatchEvent(new Event('webglcontextlost'));
  dispose();
  assert.deepEqual(f.states, ['loading', 'ready', 'error']);
  assert.equal(f.children.size, 0);
  assert.equal(f.destroyed, 1);
  assert.equal(f.disconnected, 1);
});

test('rendering failure never announces ready and still disconnects its observer', async () => {
  const f = fixture();
  f.scene.resize = () => { throw Error('render failed'); };
  mountHubScene(f.host, async () => f.scene, f.report, f.observe);
  await settled();
  assert.deepEqual(f.states, ['loading', 'error']);
  assert.equal(f.children.size, 0);
  assert.equal(f.destroyed, 1);
  assert.equal(f.disconnected, 1);
});
