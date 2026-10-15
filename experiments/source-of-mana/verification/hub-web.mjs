import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));

export async function verifyHubWeb(issue, gameBase = 'http://localhost:5185/') {
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Only navigation destinations are stubbed; game, identity and ticket redemption are real fixtures.
    await context.route('http://localhost:8088/**', route => route.fulfill({ contentType: 'text/html', body: 'Nimrod navigation fixture' }));
    const page = await context.newPage();
    await page.addInitScript(() => {
      globalThis.__hubNavigation = [];
      const open = window.open;
      window.open = function(...args) { globalThis.__hubNavigation.push(args[0]); return open.apply(this, args); };
    });
    const messages = [], errors = [];
    page.on('console', message => messages.push(message.text()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${gameBase}?nimrod_origin=${encodeURIComponent('http://localhost:8088')}#nimrod=${await issue(0)}`);
    for (let i = 0; i < 80 && !messages.some(text => text.includes('Entering new FSM state: IN_GAME')); i++) await page.waitForTimeout(1000);
    assert.ok(messages.some(text => text.includes('Entering new FSM state: IN_GAME')), 'Web character must enter the shared hub');
    await page.waitForTimeout(3000);
    assert.equal(new URL(page.url()).hash, '');
    assert.ok(!messages.some(text => /SCRIPT ERROR|FileAccess.*error|Error opening file/.test(text)), messages.join('\n'));
    const canvasMetrics = await page.locator('canvas').evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), width: node.width, height: node.height, inner: [innerWidth, innerHeight], ratio: devicePixelRatio }));
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/hub-fixture-web.png', import.meta.url)) });
    console.log('HUB_WEB_SCENE_PASS: real fixture identity, exported map, consumed fragment, no script errors');
    // Actual canvas button clicks at the reviewed desktop reference viewport.
    // These assertions also catch overlays which render correctly but steal input.
    for (const [y, destination] of [[350, '/missions'], [402, '/?experience=classic']]) {
      try {
        const [popup] = await Promise.all([
          context.waitForEvent('page', { timeout: 10000 }),
          page.mouse.click(145, y, { delay: 150 }),
        ]);
        await popup.waitForURL('http://localhost:8088/**');
        assert.equal(popup.url(), 'http://localhost:8088' + destination);
        assert.equal(await popup.evaluate(() => window.opener), null);
        await popup.close();
      } finally {
        await writeFile(new URL('../artifacts/hub-web-navigation.log', import.meta.url), JSON.stringify({ canvasMetrics, calls: await page.evaluate(() => globalThis.__hubNavigation), errors, messages }, null, 2));
        await page.screenshot({ path: fileURLToPath(new URL('../artifacts/hub-web-after-clicks.png', import.meta.url)) });
      }
    }
    // Fresh fixtures arrive at the hall; after native NPC verification their
    // camera is further north. Click the physical noticeboard in both cases.
    const boardY = process.env.MANA_HUB_WEB_ONLY === 'true' ? 48 : 144;
    const [worldBoard] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }),
      page.mouse.click(1040, boardY, { delay: 150 }),
    ]);
    await worldBoard.waitForURL('http://localhost:8088/missions');
    assert.equal(await worldBoard.evaluate(() => window.opener), null);
    await worldBoard.close();
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/hub-fixture-web-mobile.png', import.meta.url)) });
    await page.mouse.click(278, 106, { delay: 150 });
    const [mobileBoard] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }),
      page.mouse.click(145, 350, { delay: 150 }),
    ]);
    await mobileBoard.waitForURL('http://localhost:8088/missions');
    await mobileBoard.close();
    console.log('HUB_WEB_NAVIGATION_PASS: physical board, Classic mode, mobile expand/board, isolated popup origins');
    await context.close();
  } finally { await browser.close(); }
}
