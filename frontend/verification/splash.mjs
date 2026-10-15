import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.NIMROD_SPLASH_TEST_URL || 'http://127.0.0.1:5190';
const output = new URL('../../node_modules/.cache/nimrod-splash/', import.meta.url);
const fixtureName = `.splash-verification-${process.pid}.html`;
const fixture = new URL(`../${fixtureName}`, import.meta.url);
await mkdir(output, { recursive: true });
const entry = `<script type="module">
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Splash from '/src/components/SplashScreen.jsx';
import '/src/index.css';
function Fixture() {
  const [tick, setTick] = useState(0);
  const [completed, setCompleted] = useState(0);
  window.rerenderSplash = () => setTick(value => value + 1);
  return React.createElement(React.Fragment, null,
    React.createElement('output', { 'data-completed': completed }, String(completed)),
    completed ? React.createElement('main', null, 'Nimrod pronto') : React.createElement(Splash, { onDone: () => setCompleted(value => value + 1) }));
}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null, React.createElement(Fixture)));
</script>`;
const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
  .replace(/<script[^>]*src="\/src\/main\.jsx"[^>]*><\/script>/, entry);
await writeFile(fixture, html);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const reactWarnings = [];
async function open({ width = 1440, height = 900, reducedMotion = 'no-preference', brokenImage = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  if (brokenImage) await context.route('**/splash/nimrod-elements.jpeg', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type()) && /React does not recognize|Invalid DOM property|Warning:/.test(message.text())) reactWarnings.push(message.text());
  });
  await page.clock.install({ time: new Date('2026-10-15T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-15T12:00:01Z'));
  await page.goto(`${base}/${fixtureName}`);
  await page.getByRole('region', { name: 'Abertura do Nimrod' }).waitFor({ state: 'attached' });
  if (!brokenImage) await page.locator('.intro-emblem').evaluate(image => image.decode());
  return { context, page };
}
async function freezeVisual(page, time) {
  await page.evaluate(time => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
    const weave = document.querySelector('.intro-weave');
    weave?.pauseAnimations();
    weave?.setCurrentTime(time / 1000);
  }, time);
}
async function completedOnce(page) {
  await page.locator('output[data-completed="1"]').waitFor();
  assert.equal(await page.locator('.nimrod-splash').count(), 0);
  await page.clock.runFor(10000);
  assert.equal(await page.locator('output').textContent(), '1');
}
try {
  const desktop = await open();
  await freezeVisual(desktop.page, 1150);
  await desktop.page.screenshot({ path: fileURLToPath(new URL('desktop-convergence.png', output)) });
  await freezeVisual(desktop.page, 3800);
  await desktop.page.screenshot({ path: fileURLToPath(new URL('desktop-emblem.png', output)) });
  await desktop.page.clock.runFor(1000);
  await desktop.page.evaluate(() => window.rerenderSplash());
  await desktop.page.clock.runFor(4605);
  await completedOnce(desktop.page);
  await desktop.context.close();

  for (const [name, width, height] of [['mobile', 390, 844], ['landscape', 844, 390]]) {
    const sample = await open({ width, height });
    await freezeVisual(sample.page, 3800);
    const bounds = await sample.page.locator('.intro-art').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await sample.page.screenshot({ path: fileURLToPath(new URL(`${name}-emblem.png`, output)) });
    await sample.page.getByRole('button', { name: 'Pular abertura' }).click();
    await completedOnce(sample.page);
    await sample.context.close();
  }

  const reduced = await open({ reducedMotion: 'reduce' });
  assert.equal(await reduced.page.locator('.intro-weave, .intro-piece').count(), 0);
  assert.equal(await reduced.page.locator('.intro-emblem').evaluate(node => getComputedStyle(node).opacity), '1');
  await reduced.page.clock.runFor(1805);
  await completedOnce(reduced.page);
  await reduced.context.close();

  const missing = await open({ brokenImage: true });
  await missing.page.locator('.intro-image-fallback').waitFor({ state: 'attached' });
  await missing.page.keyboard.press('Escape');
  await completedOnce(missing.page);
  await missing.context.close();

  const changed = await open();
  await changed.page.emulateMedia({ reducedMotion: 'reduce' });
  await changed.page.locator('[data-reduced-motion="true"]').waitFor({ state: 'attached' });
  await changed.page.clock.runFor(1805);
  await completedOnce(changed.page);
  await changed.context.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(reactWarnings, []);
  console.log('SPLASH_PASS: exact supplied artwork, desktop/mobile/landscape, timed exit across rerenders/StrictMode, skip button/Escape, reduced motion/change, image failure and single completion');
} finally {
  await browser.close();
  await unlink(fixture);
}
