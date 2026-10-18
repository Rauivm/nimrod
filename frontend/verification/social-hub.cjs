const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;

const base = process.env.NIMROD_HUB_TEST_URL || 'http://127.0.0.1:5192';
const output = path.resolve(__dirname, '../node_modules/.cache/social-hub');
fs.mkdirSync(output, { recursive: true });
const passed = [], requests = [], errors = [];
const user = { id: 'hub-verification-user', displayName: 'Conta de verificação', role: 'PLAYER' };
const hubCharacter = (id = 'fixture-character', overrides = {}) => ({ id, userId: user.id, name: 'Personagem de verificação', level: 3,
  classe: 'Mago', race: 'Elfo', foundryActorId: 'fixture-actor', active: true, retired: false, dead: false, ...overrides });
let preview, browser;
let foundryFailure = true;

async function ready() {
  if (process.env.NIMROD_HUB_TEST_URL) return;
  const vite = path.resolve(__dirname, '../node_modules/vite/bin/vite.js');
  preview = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'pipe',
  });
  let logs = '';
  preview.stdout.on('data', chunk => { logs += chunk; });
  preview.stderr.on('data', chunk => { logs += chunk; });
  preview.on('error', error => { logs += error.message; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (preview.exitCode !== null) throw Error(`Preview failed: ${logs}`);
    try { if ((await fetch(base)).ok) return; } catch { /* Wait for our preview process. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Preview did not start: ${logs}`);
}

async function setup(authenticated = true, disableWebgl = false, mobile = false, rosterOptions = {}) {
  let rows = rosterOptions.rows ?? [hubCharacter()], rosterStatus = rosterOptions.status ?? 200, delay = rosterOptions.delay ?? 0;
  let socket, socketCount = 0;
  const localRequests = [];
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce', hasTouch: mobile, isMobile: mobile });
  await context.addInitScript(({ disableWebgl }) => {
    localStorage.setItem('lgpd_seen', 'true');
    window.__hubObservers = new Set();
    window.__hubInputListeners = new Set();
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, callback, options) => {
      if (type === 'blur') window.__hubInputListeners.add(callback);
      return add(type, callback, options);
    };
    window.removeEventListener = (type, callback, options) => {
      if (type === 'blur') window.__hubInputListeners.delete(callback);
      return remove(type, callback, options);
    };
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      observe(target, ...args) {
        if (target.classList.contains('social-hub-canvas')) window.__hubObservers.add(this);
        return super.observe(target, ...args);
      }
      disconnect() { window.__hubObservers.delete(this); return super.disconnect(); }
    };
    if (disableWebgl) {
      const nativeContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.startsWith('webgl') || type === 'experimental-webgl' ? null : nativeContext.call(this, type, ...args);
      };
    }
  }, { disableWebgl });
  // All API/WS responses are isolated fixtures. No ticket is redeemed or real data written.
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const record = { pathname: url.pathname, method: request.method() };
    requests.push(record); localRequests.push(record);
    if (url.pathname === '/api/me') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? user : { error: 'Unauthorized' } });
    if (url.pathname === '/api/me/characters') {
      const response = { status: rosterStatus, json: rosterStatus === 200 ? rows : { error: 'Personagens indisponíveis na verificação' } };
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return route.fulfill(response).catch(() => {});
    }
    if (url.pathname === '/api/notifications') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/world/calendar') return route.fulfill({ status: 503, json: { error: 'Calendar not part of this fixture' } });
    if (url.pathname === '/api/foundry/launch') return route.fulfill(foundryFailure
      ? { status: 503, json: { error: 'Foundry indisponível na verificação' } }
      : { json: { url: `${base}/__foundry_fixture__` } });
    return route.fulfill({ json: [] });
  });
  await context.route('**/__foundry_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<title>Foundry fixture</title>' }));
  await context.routeWebSocket('**/ws', connectedSocket => {
    socket = connectedSocket; socketCount++;
    socket.send(JSON.stringify({ type: 'CONNECTED', ts: Date.now() }));
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, localRequests,
    updateRoster: (nextRows, status = 200, nextDelay = 0) => { rows = nextRows; rosterStatus = status; delay = nextDelay; },
    emit: (type, data) => socket.send(JSON.stringify({ type, data, ts: Date.now() })),
    socketCount: () => socketCount,
  };
}

async function assertReady(page) {
  await page.getByRole('status').filter({ hasText: 'Prévia HTML5 disponível' }).waitFor();
  assert.equal(await page.locator('.social-hub-canvas canvas').count(), 1);
  await page.waitForFunction(() => window.__hubObservers.size === 1);
  assert.equal(await page.evaluate(() => window.__hubInputListeners.size), 1);
}

async function explorerPosition(page) {
  return page.locator('.social-hub-canvas canvas').evaluate(canvas => ({ x: Number(canvas.dataset.explorerX), y: Number(canvas.dataset.explorerY) }));
}

async function atPosition(page, point) {
  await page.waitForFunction(({ x, y }) => {
    const canvas = document.querySelector('.social-hub-canvas canvas');
    return canvas.dataset.walking === 'false' && Math.hypot(Number(canvas.dataset.explorerX) - x, Number(canvas.dataset.explorerY) - y) < 0.002;
  }, point, { timeout: 20000 });
}

async function screenPoint(page, local) {
  await page.locator('.social-hub-canvas canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('.social-hub-canvas canvas').boundingBox();
  const padding = box.width < 480 ? 8 : 20;
  const scale = Math.min((box.width - padding * 2) / 1328, (box.height - padding * 2) / 862);
  return { x: box.x + box.width / 2 + (local.x - 48) * scale, y: box.y + box.height / 2 + (local.y - 251) * scale };
}

async function floorPoint(page, point) {
  return screenPoint(page, { x: (point.x - point.y) * 48, y: (point.x + point.y) * 24 });
}

async function frameDifference(page, first, second) {
  return page.evaluate(async ([a, b]) => {
    const decode = async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const x = await decode(a), y = await decode(b);
    if (x.length !== y.length) return 1;
    let difference = 0, samples = 0;
    for (let index = 0; index < x.length; index += 32) {
      for (let channel = 0; channel < 3; channel++) difference += Math.abs(x[index + channel] - y[index + channel]);
      samples += 3;
    }
    return difference / (samples * 255);
  }, [first.toString('base64'), second.toString('base64')]);
}

(async () => {
  try {
    await ready();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const { context, page } = await setup();
    await page.goto(`${base}/lobby/html5`);
    await assertReady(page);
    assert.equal(requests.filter(r => r.pathname === '/api/me').length, 1);
    assert.ok(requests.some(r => r.pathname === '/api/me/characters'), 'HTML5 must load the existing authenticated character roster');
    assert.equal(await page.getByRole('combobox', { name: 'Personagem para explorar', exact: true }).inputValue(), 'fixture-character');
    assert.equal(await page.locator('.social-hub-canvas canvas').getAttribute('aria-label'), 'Exploração local com Personagem de verificação');
    assert.equal(await page.locator('.social-hub-canvas canvas').getAttribute('data-avatar-preset'), 'wizard');
    assert.equal(await page.locator('.social-hub-canvas canvas').getAttribute('data-avatar-equipment'), 'visual-preset');
    passed.push('The real roster contract auto-selects a sole eligible character and labels the scene with its identity');
    const graphics = await page.locator('.social-hub-canvas canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return { webgl: !!gl && !gl.isContextLost(), width: canvas.width, host: canvas.parentElement.clientWidth, renderer: canvas.dataset.renderer };
    });
    assert.equal(graphics.webgl, true);
    assert.equal(graphics.renderer, 'pixi-webgl');
    assert.ok(graphics.width >= graphics.host && graphics.host > 0);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    passed.push('Deep link loads a real Pixi/WebGL canvas through the existing authenticated shell');

    assert.equal(await page.locator('canvas[data-map="nimrod-tavern-v1"]').count(), 1);
    assert.equal(await page.getByRole('list', { name: 'Áreas do mapa' }).getByRole('listitem').count(), 5);
    const atlasPixels = await page.evaluate(async () => {
      const image = new Image(); image.src = '/social-hub/tavern-props-v1.png'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      let transparent = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] === 0) transparent++;
      return { transparent, total: image.width * image.height };
    });
    assert.ok(atlasPixels.transparent > atlasPixels.total * 0.2);
    const overview = await page.locator('.social-hub-canvas canvas').screenshot();
    await page.getByRole('button', { name: 'Aproximar câmera', exact: true }).click();
    await page.getByRole('button', { name: 'Aproximar câmera', exact: true }).click();
    assert.equal(await page.getByRole('status', { name: 'Ampliação da câmera' }).textContent(), '150%');
    assert.ok(!(await page.locator('.social-hub-canvas canvas').screenshot()).equals(overview), 'Zoom must change the rendered view');
    const canvasBox = await page.locator('.social-hub-canvas canvas').boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down(); await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 95, canvasBox.y + canvasBox.height / 2 + 40); await page.mouse.up();
    await page.getByRole('button', { name: 'Restaurar visão geral', exact: true }).click();
    const resetFrame = await page.locator('.social-hub-canvas canvas').screenshot();
    // Pixi can rerasterize text at a new resolution after zoom; compare pixels with a small tolerance.
    const resetDifference = await frameDifference(page, overview, resetFrame);
    assert.ok(resetDifference < 0.015, `Reset must restore the overview (pixel difference ${resetDifference})`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.social-hub-canvas canvas').dataset.motion === 'full');
    const movingFire = await page.locator('.social-hub-canvas canvas').screenshot();
    await page.waitForTimeout(180);
    assert.ok(!(await page.locator('.social-hub-canvas canvas').screenshot()).equals(movingFire), 'Fire/light animation must produce a changed frame');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.social-hub-canvas canvas').dataset.motion === 'reduced');
    const stillFire = await page.locator('.social-hub-canvas canvas').screenshot();
    await page.waitForTimeout(120);
    assert.ok((await page.locator('.social-hub-canvas canvas').screenshot()).equals(stillFire), 'Reduced motion must stop decorative animation');
    passed.push('Layered map uses transparent props; camera zoom/drag/reset and reduced-motion animation work');

    const ground = await floorPoint(page, { x: 7, y: 10.8 });
    await page.mouse.click(ground.x, ground.y);
    await atPosition(page, { x: 7, y: 10.8 });
    const arrived = await explorerPosition(page);
    const outside = await floorPoint(page, { x: 14.8, y: 10 });
    await page.mouse.click(outside.x, outside.y);
    await page.getByRole('status').filter({ hasText: 'Destino bloqueado ou fora do salão' }).waitFor();
    assert.deepEqual(await explorerPosition(page), arrived);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('.social-hub-canvas canvas').focus();
    await page.keyboard.down('d'); await page.keyboard.down('s');
    await page.waitForFunction(() => document.querySelector('.social-hub-canvas canvas').dataset.avatarFacing === 'se');
    const strideFrames = await page.evaluate(() => new Promise(resolve => {
      const frames = new Set(), end = performance.now() + 650;
      const sample = () => {
        frames.add(document.querySelector('.social-hub-canvas canvas').dataset.avatarFrame);
        if (performance.now() < end) requestAnimationFrame(sample); else resolve([...frames]);
      }; sample();
    }));
    await page.keyboard.up('d'); await page.keyboard.up('s');
    assert.ok(['0', '1', '2'].every(frame => strideFrames.includes(frame)), 'Walking must use all three authored poses');
    for (const [keys, facing] of [[['a', 's'], 'sw'], [['w', 'd'], 'ne'], [['w', 'a'], 'nw']]) {
      await page.keyboard.down(keys[0]); await page.keyboard.down(keys[1]);
      await page.waitForFunction(expected => document.querySelector('.social-hub-canvas canvas').dataset.avatarFacing === expected, facing);
      await page.keyboard.up(keys[0]); await page.keyboard.up(keys[1]);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.social-hub-canvas canvas').dataset.avatarFrame === '1');
    passed.push('Class sprites use actual stride frames, front/back facings, mirrors and an idle pose under reduced motion');
    await page.locator('.social-hub-canvas canvas').focus();
    await page.keyboard.down('d'); await page.waitForTimeout(180); await page.keyboard.up('d');
    await page.waitForTimeout(80);
    const keyboardPosition = await explorerPosition(page);
    assert.ok(keyboardPosition.x > arrived.x && keyboardPosition.y < arrived.y);
    await page.keyboard.down('s'); await page.waitForTimeout(80);
    await page.getByRole('button', { name: 'Aproximar câmera', exact: true }).focus();
    const blurred = await explorerPosition(page);
    await page.waitForTimeout(160); await page.keyboard.up('s');
    assert.deepEqual(await explorerPosition(page), blurred, 'Losing focus must clear held keys');
    await page.getByRole('button', { name: 'Ir até Lareira', exact: true }).click();
    await page.keyboard.press('Escape');
    const stopped = await explorerPosition(page);
    await page.waitForTimeout(160);
    assert.deepEqual(await explorerPosition(page), stopped, 'Escape must cancel a queued path');
    passed.push('Click paths, keyboard directions, rejected destinations, blur and Escape work with reduced motion');

    const board = await screenPoint(page, { x: (1.1 - 9) * 48, y: (1.1 + 9) * 24 - 85 });
    await page.mouse.click(board.x, board.y);
    await page.getByRole('heading', { name: 'Mural de missões', exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole('link', { name: 'Abrir missões do Nimrod', exact: true }).getAttribute('href'), '/missions');
    await page.getByRole('button', { name: 'Fechar interação', exact: true }).click();
    await page.getByRole('button', { name: 'Ir até Portal do Foundry', exact: true }).click();
    await page.getByRole('heading', { name: 'Portal do Foundry', exact: true }).waitFor({ timeout: 20000 });
    assert.equal(requests.filter(r => r.pathname === '/api/foundry/launch').length, 0, 'Arrival must not launch Foundry');
    const portalAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(portalAxe.violations.map(v => v.id), []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'portal.png'), fullPage: true });
    await page.getByRole('button', { name: 'Entrar no Foundry VTT', exact: true }).click();
    await page.getByText('Foundry indisponível na verificação', { exact: true }).waitFor();
    assert.equal(requests.filter(r => r.pathname === '/api/foundry/launch').length, 1);
    foundryFailure = false;
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Entrar no Foundry VTT', exact: true }).click();
    const foundryTab = await opened;
    await foundryTab.waitForURL(`${base}/__foundry_fixture__`); await foundryTab.close();
    assert.equal(requests.filter(r => r.pathname === '/api/foundry/launch').length, 2);
    // Returning from the tab can revalidate the roster; re-approach after that lifecycle.
    await page.getByRole('button', { name: 'Ir até Portal do Foundry', exact: true }).click();
    await page.getByRole('heading', { name: 'Portal do Foundry', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fechar interação', exact: true }).click();
    await page.keyboard.press('e');
    await page.getByRole('heading', { name: 'Portal do Foundry', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    passed.push('Physical board and accessible approach buttons open interactions only on arrival; E/Escape work nearby');
    passed.push('Foundry portal reuses the launch endpoint only on explicit action, with error feedback and a fixture popup');

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    passed.push('Desktop accessibility audit has zero violations');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.social-hub-canvas canvas');
      return window.innerWidth === 390
        && document.documentElement.scrollWidth <= window.innerWidth
        && Math.abs(parseFloat(canvas.style.width) - canvas.parentElement.clientWidth) < 2;
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    passed.push('Container resize and mobile width work without horizontal overflow');

    const touch = await setup(true, false, true);
    await touch.page.goto(`${base}/lobby/html5`); await assertReady(touch.page);
    const touchTarget = await floorPoint(touch.page, { x: 7, y: 10.8 });
    await touch.page.touchscreen.tap(touchTarget.x, touchTarget.y);
    await atPosition(touch.page, { x: 7, y: 10.8 });
    await touch.context.close();
    passed.push('Mobile touch moves the local explorer through the same collision/pathfinding layer');

    const meReadsBeforeSwitching = requests.filter(r => r.pathname === '/api/me').length;
    for (let index = 0; index < 4; index++) {
      await page.getByRole('navigation', { name: 'Alternar experiência' }).getByRole('link', { name: 'Modo Clássico', exact: true }).click();
      await page.getByRole('heading', { name: '📜 Taverna', exact: true }).waitFor();
      assert.equal(await page.locator('.social-hub-canvas canvas').count(), 0);
      assert.equal(await page.evaluate(() => window.__hubObservers.size), 0);
      assert.equal(await page.evaluate(() => window.__hubInputListeners.size), 0, 'Unmount must release the global blur listener');
      await page.getByRole('link', { name: 'Taverna HTML5 · Experimental', exact: true }).click();
      await assertReady(page);
    }
    assert.equal(requests.filter(r => r.pathname === '/api/me').length, meReadsBeforeSwitching, 'SPA switching must preserve the same session');
    passed.push('Four classic/HTML5 round trips keep one session, one canvas and one observer');

    await page.getByRole('navigation', { name: 'Alternar experiência' }).getByRole('link', { name: 'Source of Mana', exact: true }).click();
    await page.getByRole('button', { name: 'Entrar como Personagem de verificação', exact: true }).waitFor();
    assert.equal(await page.locator('.social-hub-canvas canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.__hubObservers.size), 0);
    assert.equal(await page.evaluate(() => window.__hubInputListeners.size), 0);
    await page.getByRole('link', { name: 'Conhecer a prévia HTML5', exact: true }).click();
    await assertReady(page);
    passed.push('Existing Mana selection remains reachable and returns to HTML5 without launching a ticket');

    // A cold context avoids Blink's already-decoded image cache bypassing a network failure fixture.
    const missingAsset = await setup();
    await missingAsset.context.route('**/social-hub/tavern-props-v1.png', route => route.fulfill({ status: 503, body: '' }));
    await missingAsset.page.goto(`${base}/lobby/html5`);
    await missingAsset.page.getByRole('alert').filter({ hasText: 'renderização está indisponível' }).waitFor();
    assert.equal(await missingAsset.page.locator('.social-hub-canvas canvas').count(), 0);
    await missingAsset.context.unroute('**/social-hub/tavern-props-v1.png');
    await missingAsset.page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await assertReady(missingAsset.page);
    await missingAsset.context.close();
    passed.push('Failed atlas loading has a recoverable error and cannot leave a partial scene');

    await page.locator('.social-hub-canvas canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost')));
    await page.getByRole('alert').filter({ hasText: 'renderização está indisponível' }).waitFor();
    assert.equal(await page.evaluate(() => window.__hubObservers.size), 0);
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await assertReady(page);
    passed.push('Context loss cleans up the scene and retry creates a fresh renderer');

    await page.getByRole('navigation', { name: 'Alternar experiência' }).getByRole('link', { name: 'Quadro de missões', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/missions');
    // The lazy destination can suspend after the URL changes; wait for React's cleanup.
    await page.waitForFunction(() => window.__hubObservers.size === 0);
    assert.equal(await page.evaluate(() => window.__hubObservers.size), 0);
    assert.equal(requests.some(r => r.method !== 'GET'), false, 'This sprint must never issue mutations or Mana launch requests');
    await context.close();

    const other = hubCharacter('second', { name: 'Outra personagem de verificação', level: 11, classe: 'Ladina', tokenImg: 'worlds/fixture/missing.webp' });
    const third = hubCharacter('third', { name: 'Personagem manual de verificação', level: null, classe: null, race: null, foundryActorId: null });
    const multiple = await setup(true, false, false, { rows: [hubCharacter(), other,
      hubCharacter('foreign', { userId: 'another-account' }), hubCharacter('dead', { dead: true }), hubCharacter('retired', { retired: true })] });
    await multiple.page.goto(`${base}/lobby/html5`);
    const choice = multiple.page.getByRole('combobox', { name: 'Personagem para explorar', exact: true });
    await choice.waitFor();
    assert.equal(await choice.locator('option').count(), 3);
    assert.equal(await multiple.page.locator('.social-hub-canvas canvas').count(), 0);
    await choice.selectOption('fixture-character'); await assertReady(multiple.page);
    await multiple.page.evaluate(() => { window.__oldCharacterCanvas = document.querySelector('.social-hub-canvas canvas'); });
    await choice.selectOption('second'); await assertReady(multiple.page);
    assert.equal(await multiple.page.evaluate(() => window.__oldCharacterCanvas.isConnected), false);
    assert.equal(await multiple.page.locator('.social-hub-canvas canvas').getAttribute('aria-label'), `Exploração local com ${other.name}`);
    await multiple.page.getByRole('region', { name: 'Personagem selecionado', exact: true }).getByText(/Nível 11 · Ladina/).waitFor();
    await multiple.page.getByRole('img', { name: 'Retrato indisponível', exact: true }).waitFor();
    assert.equal(multiple.socketCount(), 1, 'Character selection cannot open another authentication/realtime connection');
    const beforeUnrelatedEvent = multiple.localRequests.filter(request => request.pathname === '/api/me/characters').length;
    multiple.emit('CHARACTER_UPDATED', { userId: 'another-account', character: { id: 'foreign' } });
    await multiple.page.waitForTimeout(100);
    assert.equal(multiple.localRequests.filter(request => request.pathname === '/api/me/characters').length, beforeUnrelatedEvent);
    passed.push('Multiple characters require selection; other owners and ineligible records are absent; switching frees the old scene and broken portraits fall back');

    multiple.updateRoster([hubCharacter(), { ...other, dead: true }, third], 200, 300);
    multiple.emit('CHARACTER_UPDATED', { userId: user.id, character: { ...other, name: 'Forged event identity' } });
    await multiple.page.getByRole('status').filter({ hasText: 'Consultando seus personagens autorizados' }).waitFor();
    assert.equal(await multiple.page.locator('.social-hub-canvas canvas').count(), 0);
    await choice.waitFor(); assert.equal(await choice.inputValue(), '');
    assert.equal(await choice.locator('option').count(), 3);
    assert.equal(await multiple.page.getByText('Forged event identity', { exact: true }).count(), 0);
    await choice.selectOption('fixture-character'); await assertReady(multiple.page);
    multiple.updateRoster([hubCharacter('fixture-character', { level: 9, classe: 'Guerreiro' }), third]);
    multiple.emit('FOUNDRY_ACTORS_SYNCED', { updated: 1 });
    await multiple.page.getByRole('region', { name: 'Personagem selecionado', exact: true }).getByText(/Nível 9 · Guerreiro/).waitFor();
    await assertReady(multiple.page);
    assert.equal(await choice.inputValue(), 'fixture-character');
    passed.push('Existing character/sync events re-read canonical data, pause the scene, revoke dead selections and retain valid selections with updated metadata');

    await choice.selectOption('third'); await assertReady(multiple.page);
    const manualCard = multiple.page.getByRole('region', { name: 'Personagem selecionado', exact: true });
    await manualCard.getByText('Nível não informado · Classe não informada · Raça não informada', { exact: true }).waitFor();
    await manualCard.getByText('Personagem do Nimrod sem Actor Foundry vinculado', { exact: true }).waitFor();
    assert.equal(multiple.socketCount(), 1);
    await multiple.context.close();
    passed.push('Absent level/class/Actor data is explicit and never replaced with invented character or equipment data');

    const unavailableRoster = await setup(true, false, false, { status: 503 });
    await unavailableRoster.page.goto(`${base}/lobby/html5`);
    await unavailableRoster.page.getByRole('alert').filter({ hasText: 'Não foi possível carregar seus personagens' }).waitFor();
    assert.equal(await unavailableRoster.page.locator('.social-hub-canvas canvas').count(), 0);
    unavailableRoster.updateRoster([hubCharacter()]);
    await unavailableRoster.page.getByRole('button', { name: 'Tentar carregar personagens novamente', exact: true }).click();
    await assertReady(unavailableRoster.page);
    unavailableRoster.updateRoster([], 401);
    await unavailableRoster.page.getByRole('button', { name: 'Atualizar personagens da taverna', exact: true }).click();
    await unavailableRoster.page.getByRole('alert').filter({ hasText: 'Não foi possível carregar seus personagens' }).waitFor();
    assert.equal(await unavailableRoster.page.locator('.social-hub-canvas canvas').count(), 0);
    unavailableRoster.updateRoster([]);
    await unavailableRoster.page.getByRole('button', { name: 'Tentar carregar personagens novamente', exact: true }).click();
    await unavailableRoster.page.getByRole('link', { name: 'Vincular personagem no Perfil', exact: true }).waitFor();
    assert.equal(await unavailableRoster.page.locator('.social-hub-canvas canvas').count(), 0);
    await unavailableRoster.context.close();
    passed.push('Roster failure/401/empty states suspend rendering and recover through the existing endpoint without a fabricated avatar');

    const lateRoster = await setup(true, false, false, { delay: 450 });
    await lateRoster.page.goto(`${base}/lobby/html5`);
    await lateRoster.page.getByRole('status').filter({ hasText: 'Consultando seus personagens autorizados' }).waitFor();
    await lateRoster.page.getByRole('navigation', { name: 'Alternar experiência' }).getByRole('link', { name: 'Modo Clássico', exact: true }).click();
    await lateRoster.page.getByRole('heading', { name: '📜 Taverna', exact: true }).waitFor();
    await lateRoster.page.waitForTimeout(550);
    assert.equal(await lateRoster.page.locator('.social-hub-canvas canvas').count(), 0);
    assert.equal(await lateRoster.page.evaluate(() => window.__hubInputListeners.size), 0);
    const beforeDetachedEvent = lateRoster.localRequests.filter(request => request.pathname === '/api/me/characters').length;
    lateRoster.emit('CHARACTER_UPDATED', { userId: user.id });
    await lateRoster.page.waitForTimeout(100);
    assert.equal(lateRoster.localRequests.filter(request => request.pathname === '/api/me/characters').length, beforeDetachedEvent, 'Unmount must unsubscribe from character events');
    await lateRoster.context.close();
    passed.push('A roster reply arriving after navigation cannot recreate a scene or leak input listeners');

    const classes = [['fighter', 'Guerreiro'], ['paladin', 'Paladino'], ['ranger', 'Patrulheiro'], ['rogue', 'Ladino'],
      ['wizard', 'Mago'], ['sorcerer', 'Feiticeiro'], ['warlock', 'Bruxo'], ['cleric', 'Clérigo'],
      ['druid', 'Druida'], ['bard', 'Bardo'], ['barbarian', 'Bárbaro'], ['monk', 'Monge'], ['traveler', 'Classe personalizada']];
    const gallery = await setup(true, false, false, { rows: classes.map(([id, classe]) => hubCharacter(id, { name: `Teste ${classe}`, classe })) });
    await gallery.page.goto(`${base}/lobby/html5`);
    const snapshots = new Map();
    for (const [id, classe] of classes) {
      await gallery.page.getByRole('combobox', { name: 'Personagem para explorar', exact: true }).selectOption(id);
      await assertReady(gallery.page);
      assert.equal(await gallery.page.locator('.social-hub-canvas canvas').getAttribute('data-avatar-preset'), id);
      const p = await floorPoint(gallery.page, { x: 4.7, y: 2.3 });
      const buffer = await gallery.page.screenshot({ clip: { x: p.x - 80, y: p.y - 150, width: 160, height: 180 } });
      snapshots.set(id, buffer);
      fs.writeFileSync(path.join(output, `avatar-${id}.png`), buffer);
      assert.ok(await gallery.page.getByText(`Aparência: ${id === 'traveler' ? 'Viajante (traje neutro)' : classe}`, { exact: true }).isVisible());
    }
    assert.equal(gallery.socketCount(), 1);
    await gallery.context.route('**/__avatar_snapshots__/*', route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      return route.fulfill({ contentType: 'image/png', body: snapshots.get(id) });
    });
    await gallery.context.route('**/__avatar_gallery__', route => route.fulfill({ contentType: 'text/html', body:
      `<html lang="pt-BR"><meta charset="utf-8"><title>Presets de classe — verificação</title><style>body{margin:0;padding:24px;background:#151b24;color:#efdab7;font:16px Georgia}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(4,185px);gap:14px}figure{margin:0;padding:8px;background:#202a37;border:1px solid #7d6947;border-radius:8px}figcaption{margin-bottom:8px}img{display:block;width:160px;height:180px}</style><h1>Sprint 6 · presets no renderizador real</h1><main>${classes.map(([id, label]) => `<figure><figcaption>${label}</figcaption><img src="/__avatar_snapshots__/${id}" alt="${label}"></figure>`).join('')}</main></html>` }));
    const galleryPage = await gallery.context.newPage();
    await galleryPage.goto(`${base}/__avatar_gallery__`);
    const avatarTransparency = await galleryPage.evaluate(async () => {
      const result = [];
      for (const name of ['martial', 'arcane', 'primal', 'traveler']) {
        const image = new Image(); image.src = `/social-hub/avatars-${name}-v1.png`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        let transparent = 0;
        for (let at = 3; at < pixels.length; at += 4) if (pixels[at] === 0) transparent++;
        result.push({ name, ratio: transparent / (image.width * image.height) });
      }
      return result;
    });
    assert.ok(avatarTransparency.every(sheet => sheet.ratio > 0.3), 'All avatar sheets need true transparent space around independent figures');
    await galleryPage.screenshot({ path: path.join(output, 'avatar-gallery.png'), fullPage: true });
    await gallery.context.close();
    passed.push('All twelve class sprites and the neutral traveler load with one canvas/listener and one existing socket; visual gallery captured from the real renderer');

    const unavailableAvatar = await setup();
    await unavailableAvatar.context.route('**/social-hub/avatars-arcane-v1.png', route => route.fulfill({ status: 503, body: '' }));
    await unavailableAvatar.page.goto(`${base}/lobby/html5`);
    await unavailableAvatar.page.getByRole('alert').filter({ hasText: 'renderização está indisponível' }).waitFor();
    assert.equal(await unavailableAvatar.page.locator('.social-hub-canvas canvas').count(), 0);
    assert.equal(await unavailableAvatar.page.evaluate(() => window.__hubInputListeners.size), 0);
    await unavailableAvatar.context.unroute('**/social-hub/avatars-arcane-v1.png');
    await unavailableAvatar.page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await assertReady(unavailableAvatar.page);
    await unavailableAvatar.context.close();
    passed.push('Missing avatar artwork cannot leave a partial scene and retry loads a fresh owned atlas');

    const blocked = await setup(true, true);
    await blocked.page.goto(`${base}/lobby/html5`);
    await blocked.page.getByRole('alert').filter({ hasText: 'renderização está indisponível' }).waitFor();
    assert.equal(await blocked.page.locator('.social-hub-canvas canvas').count(), 0);
    await blocked.page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await blocked.page.getByRole('alert').filter({ hasText: 'renderização está indisponível' }).waitFor();
    await blocked.page.getByRole('link', { name: 'Modo Clássico', exact: true }).click();
    await blocked.page.getByRole('heading', { name: '📜 Taverna', exact: true }).waitFor();
    await blocked.context.close();
    passed.push('Unavailable WebGL exposes retry and classic fallback without an unhandled failure');

    const guest = await setup(false);
    await guest.page.goto(`${base}/lobby/html5`);
    await guest.page.getByRole('status').filter({ hasText: 'Entre na sua conta Nimrod para acessar a prévia' }).waitFor();
    assert.equal(await guest.page.locator('.social-hub-canvas canvas').count(), 0);
    assert.equal(await guest.page.evaluate(() => window.__hubObservers.size), 0);
    assert.equal(guest.localRequests.some(request => request.pathname === '/api/me/characters'), false);
    await guest.context.close();
    passed.push('No renderer starts when the existing session is unauthenticated');
    assert.deepEqual(errors, []);
    const report = {
      passed, pageErrors: errors, artifacts: output,
      atlasTransparentRatio: atlasPixels.transparent / atlasPixels.total,
      cameraResetPixelDifference: resetDifference,
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const pages = browser?.contexts().flatMap(context => context.pages()) ?? [];
    if (pages[0]) {
      await pages[0].screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      console.error(JSON.stringify({ passed, errors, diagnostic: await pages[0].evaluate(() => ({
        motion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        canvas: { ...document.querySelector('.social-hub-canvas canvas')?.dataset },
        notice: document.querySelector('.social-hub-notice')?.textContent,
      })).catch(() => null) }));
    }
    throw error;
  } finally {
    await browser?.close();
    preview?.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
