const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Use a locally installed Playwright, or the desktop's supplied runtime.
const { chromium } = require(process.env.NIMROD_PLAYWRIGHT || 'playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const base = process.env.NIMROD_UI_TEST_URL || 'http://127.0.0.1:5191';
const output = path.resolve(__dirname, '../../node_modules/.cache/nimrod-redesign');
fs.mkdirSync(output, { recursive: true });
const failures = [], requests = [], consoleErrors = [], passed = [];
const accessibility = [];
async function audit(page, route) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  accessibility.push({ route, violations: results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
}
const user = { id: 'player', displayName: 'Liora', name: 'Liora', role: 'PLAYER', avatarUrl: null };
const character = { id: 'character-1', name: 'Liora das Estrelas', level: 5, active: true, retired: false, dead: false, xp: 300, xpNext: 1000, classes: [], biography: 'Uma exploradora das terras do norte.' };
const template = { kind: 'MISSION', title: 'As ruínas de Valdoria', description: 'Uma torre abandonada guarda os mapas de um reino esquecido. Reúna seu grupo e explore os salões sob a luz da lua.', creator_id: 'gm', creator_name: 'Rafael', gm_id: 'gm', gm_name: 'Rafael', status: 'OPEN', registrations_open: true, min_players: 1, max_players: 4, max_reserves: 2, min_level: 1, max_level: 8, player_count: 2, reserve_count: 0, approval_required: false, participants: [], reactions: [], sessions: [], gmRequests: [], user_joined: false, datetime: '2026-11-15T23:00:00Z', registration_deadline: null, reward: '250 XP e um mapa ancestral', created_at: '2026-10-17T02:00:00Z' };
let missions, role = 'PLAYER', failPath = '', pageSize = false;
function reset() {
  missions = [
    { ...template, id: 'mission-1' },
    { ...template, id: 'mission-2', title: 'O último farol', player_count: 4, reserve_count: 1, gm_id: null, gm_name: null, approval_required: true },
    { ...template, id: 'mission-3', title: 'Ecos do bosque', status: 'PAUSED', player_count: 1, user_joined: true, user_approval_status: 'PENDING' },
    { ...template, id: 'notice-1', kind: 'NOTICE', title: 'Um encontro na taverna', description: 'Na próxima lua, traga suas histórias e reencontre a comunidade.' },
  ];
  failPath = ''; pageSize = false;
}
const calendar = { season: 'SPRING', nextSeason: 'SUMMER', year: 1492, currentSession: 17, weekOfSeason: 5, sessionInYear: 17, sessionsUntilNextSeason: 7, effects: [], updatedAt: '2026-10-17T02:00:00Z' };
async function setup(context) {
  await context.addInitScript(() => {
    localStorage.setItem('lgpd_seen', 'true');
    if (localStorage.getItem('nimrod:test:first-visit') !== 'true') {
      localStorage.setItem('nimrod:experience:player', 'classic');
      localStorage.setItem('nimrod:experience:gm', 'classic');
    }
  });
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname.replace(/^\/api/, ''), method = request.method();
    const body = request.postDataJSON();
    requests.push({ p, method, body, query: url.search });
    if (failPath && p === failPath) return route.fulfill({ status: 503, json: { error: 'Falha de leitura simulada' } });
    let json = [];
    const me = role === 'PLAYER' ? user : { ...user, id: 'gm', displayName: 'Rafael', role };
    if (p === '/me') json = me;
    else if (p === '/me/characters' || p === '/me/characters/available') json = [character];
    else if (/^\/players\/.+\/profile$/.test(p)) json = { user: me, characters: [character], stats: { totalMissions: 8, activeMissions: 2 } };
    else if (p === '/world/calendar') json = calendar;
    else if (p.startsWith('/world/calendar/effects/')) json = [];
    else if (p === '/notifications') json = { items: [{ id: 'n1', message: 'Uma nova vaga está disponível em Valdoria.', mission_id: 'mission-1', read_at: null }] };
    else if (p === '/missions' && method === 'POST') { json = { ...template, ...body, id: 'created-mission' }; missions.unshift(json); }
    else if (p === '/missions') {
      json = missions.filter(m => (!url.searchParams.get('kind') || m.kind === url.searchParams.get('kind')) && (!url.searchParams.get('status') || url.searchParams.get('status').split(',').includes(m.status)));
      if (pageSize) json = url.searchParams.has('before') ? [{ ...template, id: 'old-mission', title: 'Missão antiga' }] : Array.from({ length: 30 }, (_, i) => ({ ...template, id: 'page-' + i, title: 'Missão ' + i, created_at: `2026-10-${String(17 - Math.floor(i / 4)).padStart(2, '0')}T0${i % 4}:00:00Z` }));
    } else if (/^\/missions\/[^/]+\/join$/.test(p)) {
      const id = p.split('/')[2], mission = missions.find(m => m.id === id);
      const updated = { ...mission, user_joined: method !== 'DELETE', user_approval_status: mission.approval_required ? 'PENDING' : 'APPROVED' };
      missions = missions.map(m => m.id === id ? updated : m); json = { mission: updated };
    } else if (/^\/missions\/[^/]+$/.test(p)) json = missions.find(m => m.id === p.split('/')[2]) || { ...template, id: p.split('/')[2], title: 'Aventura do arquivo' };
    else if (p === '/posts') json = [{ id: 'p1', content: 'O grupo voltou de Valdoria com novas histórias. Quem se junta à próxima aventura?', author: me, createdAt: '2026-10-17T02:00:00Z', likeCount: 3, likedByMe: false, replyCount: 0 }];
    else if (p === '/maps') json = [{ id: 'map-1', title: 'Terras de Valdoria', description: 'Um guia para a próxima expedição.', uploader_name: 'Rafael', created_at: '2026-10-17T02:00:00Z', file_url: '/test-map.pdf', file_name: 'Valdoria.pdf' }];
    else if (p === '/sidequests') json = [{ id: 'sq1', title: 'Pesquisar os arquivos do reino', description: 'Traduza os manuscritos e descubra uma rota para o norte.', status: 'WAITING', rules: { attribute: 'int' }, progress: 12, goal: 30, participantCount: 2, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }];
    else if (p === '/cemetery') json = [{ id: 'memorial-1', name: 'Aldren, o Guardião', description: 'Seu juramento permanece entre as montanhas.', owner_name: 'Liora', owner_id: 'player', tribute_count: 3, created_at: '2026-10-01T00:00:00Z' }];
    else if (p === '/cemetery/characters') json = [{ ...character, id: 'fallen-1', name: 'Thalia do Norte', dead: true, retired: true, ownerName: 'Liora', owner_id: 'player', tribute_count: 8, dead_at: '2026-10-01T00:00:00Z', origin: 'foundry' }];
    else if (p === '/patch-notes' || p === '/patch-notes/all') json = [{ id: 'note-1', title: 'Crônicas de Valdoria · Novas regras', version: '1.2', summary: 'Combinados para a próxima aventura.', author: me, published: true, createdAt: '2026-10-01T00:00:00Z', content: { sections: [] } }];
    else if (p === '/sessions') json = [{ id: 'session-1', title: 'A torre esquecida', campaign: 'Crônicas de Valdoria', status: 'open', startedAt: '2026-10-17T02:00:00Z', primaryGm: 'Rafael' }];
    else if (p === '/sessions/session-1/events') json = [{ id: 'event-1', sessionId: 'session-1', resourceType: 'gold', delta: 25, playerId: 'player', playerName: 'Liora', characterId: character.id, actorName: character.name, description: 'Tesouro da torre', source: 'manual', createdAt: '2026-10-17T02:00:00Z' }];
    else if (/^\/missions\/[^/]+\/(start|pause|cancel|close-registrations|open-registrations)$/.test(p)) {
      const [, , id, action] = p.split('/');
      const mission = missions.find(m => m.id === id);
      const status = { start: 'RUNNING', pause: 'PAUSED', cancel: 'CANCELLED' }[action] || mission.status;
      json = { ...mission, status, ...(action === 'close-registrations' ? { registrations_open: false } : action === 'open-registrations' ? { registrations_open: true } : {}) };
      missions = missions.map(m => m.id === id ? json : m);
    }
    else if (p === '/foundry/identity-links') json = [{ world_id: 'valdoria', foundry_user_id: 'foundry-player' }];
    else if (p.startsWith('/foundry/identity/')) json = { world_id: 'valdoria', foundry_user_id: 'foundry-player', requested_gm: false };
    else if (p === '/config') json = { foundryUrl: 'http://example.test' };
    return route.fulfill({ status: 200, json });
  });
  // Never connect the fixture to a real realtime service.
  await context.routeWebSocket('**/ws', ws => { ws.send(JSON.stringify({ type: 'CONNECTED', data: {} })); });
}
async function go(page, route) {
  const wasSameDocument = page.url().split('#')[0] === (base + route).split('#')[0];
  await page.goto(base + route);
  if (wasSameDocument) await page.reload();
  const skip = page.getByRole('button', { name: 'Pular abertura' });
  await skip.waitFor({ timeout: 15000 });
  await skip.click();
  await page.locator('.site-main').waitFor();
  await page.locator('.app-loading').waitFor({ state: 'detached' });
  await page.waitForTimeout(150);
}
async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(result.scroll <= result.width + 1, `${label}: horizontal overflow ${JSON.stringify(result)}`);
}
async function test(name, fn) {
  try { await fn(); passed.push(name); console.log('PASS ' + name); }
  catch (error) { failures.push({ name, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); }
}
(async () => {
  reset();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await setup(context);
  const page = await context.newPage();
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && /Warning:|React does not|Invalid/.test(msg.text())) consoleErrors.push(msg.text()); });
  try {
    await test('board summary, direct enrollment and unchanged payload', async () => {
      await go(page, '/missions');
      await page.getByRole('heading', { name: 'Quadro de Avisos', exact: true }).waitFor();
      await page.getByText('Ao vivo', { exact: true }).waitFor();
      assert.equal(await page.locator('.poster').count(), 3);
      assert.equal(await page.getByText('2 vagas disponíveis', { exact: true }).count(), 1);
      await noOverflow(page, 'desktop board');
      await page.screenshot({ path: path.join(output, 'board-desktop.png'), fullPage: true });
      await page.locator('#mission-mission-1').getByRole('button', { name: 'Participar da missão' }).click();
      const dialog = page.getByRole('dialog', { name: 'Participar da missão' });
      await dialog.waitFor();
      await audit(page, 'Inscrição · diálogo');
      assert.equal(await dialog.getByRole('button', { name: /Liora das Estrelas/ }).getAttribute('aria-pressed'), 'true');
      await dialog.getByRole('button', { name: 'Entrar como Aventureiro' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.getByText('Você está inscrito', { exact: true }).waitFor();
      assert.deepEqual(requests.find(r => r.p === '/missions/mission-1/join' && r.method === 'POST').body, { characterId: 'character-1' });
    });
    await test('launch failure is visible without a false success message', async () => {
      failPath = '/foundry/launch';
      await page.getByRole('button', { name: 'Entrar na aventura', exact: true }).click();
      await page.locator('.ui-toast-error').getByText('Falha de leitura simulada').waitFor();
      failPath = '';
    });
    await test('search accents, empty feedback and independent type/status filters', async () => {
      const search = page.getByRole('searchbox');
      await search.fill('ruinas rafael'); assert.equal(await page.locator('.poster').count(), 1);
      await search.fill('inexistente'); await page.getByText('Nenhuma publicação corresponde aos filtros').waitFor();
      await search.clear(); await page.getByRole('group', { name: 'Tipo de publicação' }).getByRole('button', { name: 'Avisos', exact: true }).click();
      await page.getByRole('heading', { name: 'Um encontro na taverna' }).waitFor();
      await page.getByRole('combobox', { name: 'Estado da aventura' }).selectOption('OPEN');
      await page.getByRole('heading', { name: 'Um encontro na taverna' }).waitFor();
      assert.ok(requests.some(r => r.query.includes('kind=NOTICE') && r.query.includes('status=OPEN')));
    });
    await test('native dialog focus trap, Escape, focus return and creation payload', async () => {
      await page.getByRole('button', { name: 'Nova missão / aviso' }).click();
      const dialog = page.getByRole('dialog', { name: 'Publicar no Quadro de Avisos' });
      await dialog.waitFor();
      await audit(page, 'Criação · diálogo');
      for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(d => d.contains(document.activeElement)));
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('button', { name: 'Nova missão / aviso' }).evaluate(e => e === document.activeElement), true);
      await page.getByRole('button', { name: 'Nova missão / aviso' }).click();
      await dialog.getByLabel('Título', { exact: false }).fill('Crônicas da aurora');
      await dialog.getByLabel('Nível mínimo').fill('1'); await dialog.getByLabel('Nível máximo').fill('8');
      await dialog.getByLabel('Mínimo de jogadores').fill('1');
      await dialog.getByRole('button', { name: 'Criar missão', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const payload = requests.find(r => r.p === '/missions' && r.method === 'POST').body;
      assert.equal(payload.datetime, null); assert.equal(payload.minPlayers, '1'); assert.equal(payload.kind, 'MISSION');
    });
    await test('load errors expose retry and never masquerade as an empty board', async () => {
      failPath = '/missions'; await go(page, '/missions');
      await page.getByRole('alert').filter({ hasText: 'Não foi possível atualizar o quadro' }).waitFor();
      assert.equal(await page.getByText('O próximo capítulo ainda está por vir').count(), 0);
      failPath = ''; await page.getByRole('button', { name: 'Tentar novamente' }).click();
      await page.getByRole('heading', { name: 'Crônicas da aurora' }).waitFor();
    });
    await test('pagination remains available when local search finds no match', async () => {
      pageSize = true; await go(page, '/missions');
      await page.getByRole('searchbox').fill('antiga');
      await page.getByRole('button', { name: 'Carregar mais publicações' }).click();
      await page.getByRole('heading', { name: 'Missão antiga' }).waitFor();
      assert.ok(requests.some(r => r.query.includes('before=')));
      pageSize = false;
    });
    await test('inbox deep link resolves a mission outside the initial batch', async () => {
      await go(page, '/missions#mission-archived-mission');
      await page.getByRole('heading', { name: 'Aventura do arquivo' }).waitFor();
    });
    const themes = [['nimrod', 'NIMROD'], ['fire', 'Fogo'], ['water', 'Água'], ['earth', 'Terra'], ['air', 'Ar'], ['light', 'Luz'], ['shadow', 'Sombra']];
    const chooseTheme = async name => {
      await page.getByRole('button', { name: 'Escolher tema elemental' }).click();
      const dialog = page.getByRole('dialog', { name: 'Sua afinidade elemental' });
      await dialog.getByRole('radio', { name, exact: true }).check();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    };
    for (const [id, name] of themes) await test(`element ${name}: preview, persistence, contrast and unchanged status colors`, async () => {
      await go(page, '/missions');
      const semantic = await page.evaluate(() => ['--emerald-bright', '--warning', '--crimson-bright'].map(token => getComputedStyle(document.documentElement).getPropertyValue(token)));
      await chooseTheme(name);
      assert.equal(await page.locator('html').getAttribute('data-element'), id);
      assert.equal(await page.evaluate(() => localStorage.getItem('nimrod:element:player') || 'nimrod'), id);
      await go(page, '/missions');
      assert.equal(await page.locator('html').getAttribute('data-element'), id);
      assert.deepEqual(await page.evaluate(() => ['--emerald-bright', '--warning', '--crimson-bright'].map(token => getComputedStyle(document.documentElement).getPropertyValue(token))), semantic);
      await audit(page, `Afinidade ${name} · quadro`);
      await noOverflow(page, name);
      if (['fire', 'water', 'shadow'].includes(id)) await page.screenshot({ path: path.join(output, `board-${id}.png`), fullPage: true });
    });
    await test('element picker keyboard navigation and native modal focus', async () => {
      await page.getByRole('button', { name: 'Escolher tema elemental' }).click();
      const dialog = page.getByRole('dialog', { name: 'Sua afinidade elemental' });
      await dialog.getByRole('radio', { name: 'Fogo', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await dialog.getByRole('radio', { name: 'Água', exact: true }).isChecked(), true);
      await audit(page, 'Seletor de afinidade');
      await dialog.screenshot({ path: path.join(output, 'element-picker.png') });
      await dialog.getByRole('radio', { name: 'NIMROD', exact: true }).check();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Escolher tema elemental' }).evaluate(node => node === document.activeElement), true);
    });
    await test('invalid stored affinity recovers and storage events synchronize', async () => {
      await page.evaluate(() => localStorage.setItem('nimrod:element:player', 'invalid-theme'));
      await go(page, '/missions');
      assert.equal(await page.locator('html').getAttribute('data-element'), 'nimrod');
      await page.evaluate(() => {
        localStorage.setItem('nimrod:element:player', 'earth');
        window.dispatchEvent(new StorageEvent('storage', { key: 'nimrod:element:player', newValue: 'earth' }));
      });
      await page.waitForFunction(() => document.documentElement.dataset.element === 'earth');
      await chooseTheme('NIMROD');
    });
    await test('element preference survives navigation across modules', async () => {
      await chooseTheme('Água');
      for (const route of ['/profile', '/calendar', '/lobby', '/maps', '/']) {
        await go(page, route);
        assert.equal(await page.locator('html').getAttribute('data-element'), 'water');
      }
      await chooseTheme('NIMROD');
    });
    await test('blocked theme storage keeps a usable session preference and explains its limit', async () => {
      await page.evaluate(() => {
        window.nimrodOriginalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('nimrod:element:')) throw new DOMException('Storage disabled', 'SecurityError');
          return window.nimrodOriginalSetItem.call(this, key, value);
        };
      });
      try {
        await page.getByRole('button', { name: 'Escolher tema elemental' }).click();
        const dialog = page.getByRole('dialog', { name: 'Sua afinidade elemental' });
        await dialog.getByRole('radio', { name: 'Luz', exact: true }).check();
        assert.equal(await page.locator('html').getAttribute('data-element'), 'light');
        await dialog.getByRole('status').filter({ hasText: 'O navegador não permitiu salvar sua preferência' }).waitFor();
        await page.keyboard.press('Escape');
      } finally {
        await page.evaluate(() => { Storage.prototype.setItem = window.nimrodOriginalSetItem; delete window.nimrodOriginalSetItem; });
      }
      await chooseTheme('NIMROD');
    });
    await test('320px elemental controls and picker keep touch targets and reflow', async () => {
      await page.setViewportSize({ width: 320, height: 900 });
      await go(page, '/missions');
      await page.getByRole('button', { name: 'Escolher tema elemental' }).click();
      const dialog = page.getByRole('dialog', { name: 'Sua afinidade elemental' });
      await dialog.getByRole('radio', { name: 'Sombra', exact: true }).check();
      await noOverflow(page, 'mobile theme picker');
      assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
      await audit(page, 'Seletor elemental · 320px');
      await dialog.getByRole('radio', { name: 'NIMROD', exact: true }).check();
      await page.keyboard.press('Escape');
      await noOverflow(page, '320px themed board');
    });
    const routes = ['/', '/missions', '/profile', '/profile/other', '/lobby', '/foundry-connect', '/calendar', '/maps', '/cemetery', '/patch-notes', '/sidequests'];
    for (const width of [1440, 1024, 768, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) await test(`${width}px route ${route}`, async () => {
        await go(page, route); await noOverflow(page, route);
        assert.equal(await page.locator('main h1').count(), 1, 'One primary heading per route');
        if (width === 1440) await audit(page, route);
        if (width === 360 && route === '/missions') await page.screenshot({ path: path.join(output, 'board-mobile.png'), fullPage: true });
        if (width === 1440 && ['/', '/profile', '/calendar'].includes(route)) await page.screenshot({ path: path.join(output, route === '/' ? 'community.png' : route.slice(1) + '.png'), fullPage: true });
      });
    }
    await test('mobile navigation is named, keyboard contained and dismissible', async () => {
      await page.getByRole('button', { name: 'Abrir navegação' }).click();
      const menu = page.getByRole('dialog', { name: 'Navegação principal' });
      await menu.waitFor();
      for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
      assert.ok(await menu.evaluate(d => d.contains(document.activeElement)));
      await page.keyboard.press('Escape'); assert.equal(await menu.count(), 0);
      await page.getByRole('button', { name: 'Abrir navegação' }).click();
      await page.getByRole('link', { name: 'Calendário', exact: true }).click();
      await page.getByRole('heading', { name: 'Calendário do Mundo' }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    });
    await chooseTheme('Fogo');
    role = 'GM_PRINCIPAL';
    await test('changing account does not leak the previous account affinity', async () => {
      await go(page, '/missions');
      assert.equal(await page.locator('html').getAttribute('data-element'), 'nimrod');
      await chooseTheme('Terra');
      assert.equal(await page.evaluate(() => localStorage.getItem('nimrod:element:gm')), 'earth');
      assert.equal(await page.evaluate(() => localStorage.getItem('nimrod:element:player')), 'fire');
      await chooseTheme('NIMROD');
    });
    for (const width of [1440, 360]) for (const route of ['/gm/sessions', '/sidequests', '/profile', '/calendar', '/missions']) await test(`GM ${width}px ${route}`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await go(page, route); await noOverflow(page, route);
      if (width === 1440) await audit(page, 'GM ' + route);
      if (route === '/gm/sessions') { await page.getByText('A torre esquecida', { exact: true }).first().waitFor(); await page.getByRole('button', { name: 'Evento', exact: true }).click(); await page.getByRole('dialog', { name: 'Registrar evento' }).waitFor(); await noOverflow(page, 'session dialog'); await page.keyboard.press('Escape'); }
    });
    await test('GM lifecycle controls retain endpoint names and payloads', async () => {
      reset(); await go(page, '/missions');
      const mission = page.locator('#mission-mission-1');
      await mission.getByRole('button', { name: /Ver detalhes/ }).click();
      await audit(page, 'GM · missão expandida');
      await mission.getByRole('button', { name: 'Encerrar inscrições', exact: true }).click();
      await mission.getByRole('button', { name: 'Reabrir inscrições', exact: true }).waitFor();
      await mission.getByRole('button', { name: 'Iniciar sessão', exact: true }).click();
      await mission.getByRole('button', { name: 'Encerrar sessão e pausar', exact: true }).click();
      await mission.getByRole('button', { name: 'Iniciar próxima sessão', exact: true }).waitFor();
      const calls = requests.filter(r => /\/mission-1\/(start|pause|close-registrations)$/.test(r.p));
      assert.equal(calls.length, 3); assert.ok(calls.every(r => r.method === 'POST' && r.body.confirmed === true));
    });
    await test('first visit keeps both classic and game entry choices', async () => {
      await page.evaluate(() => { localStorage.removeItem('nimrod:experience:gm'); localStorage.setItem('nimrod:test:first-visit', 'true'); });
      await go(page, '/');
      await page.getByRole('heading', { name: /Seu próximo encontro/ }).waitFor();
      await audit(page, 'Escolha de experiência');
      await noOverflow(page, 'experience entry mobile');
      await page.getByRole('button', { name: 'Conhecer a taverna' }).click();
      await page.getByRole('heading', { name: 'Inn do Nimrod' }).waitFor();
    });
    await test('WCAG automated checks have no violations in audited states', async () => {
      assert.deepEqual(accessibility.filter(result => result.violations.length), []);
    });
    await test('no uncaught React/runtime errors', async () => assert.deepEqual(consoleErrors, []));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed, failures, consoleErrors, accessibility, requests: requests.length }, null, 2));
  }
  if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
  else console.log('REDESIGN_PASS: routes, responsive layouts, enrollment, creation, filtering, pagination, deep links, failures, dialogs and keyboard navigation. Artifacts: ' + output);
})().catch(error => { console.error(error); process.exitCode = 1; });
