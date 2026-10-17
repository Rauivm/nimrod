// Requires an externally available Playwright runtime; no production credentials.
const path = require('node:path');
const artifacts = process.env.MISSION_TEST_ARTIFACTS || path.resolve(__dirname, '../../../node_modules/.cache/nimrod-audit');
require('node:fs').mkdirSync(artifacts, {
  recursive: true
});
const {
  chromium,
  expect,
  request
} = require('playwright/test');
(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true
  });
  const base = 'http://127.0.0.1:55439';
  const gmApi = await request.newContext({
    baseURL: base
  });
  const playerApi = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: {
      'X-Dev-User': 'browser-player@example.test'
    }
  });
  const gm = await (await gmApi.get('/api/me')).json();
  const mission = await (await gmApi.post('/api/missions', {
    data: {
      title: `Foundry panel ${Date.now()}`,
      description: 'Synthetic Foundry workflow',
      minPlayers: 1,
      maxPlayers: 2,
      maxReserves: 2,
      minLevel: 1,
      maxLevel: 5
    }
  })).json();
  const applied = await (await gmApi.post(`/api/missions/${mission.id}/gm-requests`, {
    data: {
      kind: 'APPLICATION'
    }
  })).json();
  await gmApi.patch(`/api/missions/${mission.id}/gm-requests/${applied.gmRequests.find(r => r.status === 'PENDING').id}`, {
    data: {
      accept: true
    }
  });
  await playerApi.post(`/api/missions/${mission.id}/join`, {
    data: {}
  });
  const world = `browser-world-${Date.now()}`;
  const errors = [];
  async function setup(context, isGM, foundryUserId) {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/foundry-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><h1>Foundry API fixture</h1></body></html>'
    }));
    await page.goto(`${base}/foundry-fixture`);
    await install(page, isGM, foundryUserId);
    return page;
  }
  async function install(page, isGM, foundryUserId) {
    await page.evaluate(({
      isGM,
      foundryUserId,
      world,
      base
    }) => {
      const values = new Map([['nimrod-bridge.nimrodUrl', `${base}/api`], ['nimrod-bridge.nimrodApiKey', 'mission-audit-synthetic-key-only']]);
      values.set('nimrod-bridge.missionIdentity', JSON.parse(localStorage.getItem(`fixture-${foundryUserId}`) || '{}'));
      window.game = {
        world: {
          id: world
        },
        user: {
          id: foundryUserId,
          isGM,
          name: 'Visible name is not identity'
        },
        settings: {
          get: (m, k) => values.get(`${m}.${k}`),
          register: (m, k, s) => {
            if (!values.has(`${m}.${k}`)) values.set(`${m}.${k}`, s.default);
          },
          set: async (m, k, v) => {
            values.set(`${m}.${k}`, v);
            if (k === 'missionIdentity') localStorage.setItem(`fixture-${foundryUserId}`, JSON.stringify(v));
          }
        }
      };
      window.fixtureHooks = {};
      window.Hooks = {
        once: (event, fn) => window.fixtureHooks[event] = fn
      };
      window.onLinked = async id => window.fixtureLinked = id;
    }, {
      isGM,
      foundryUserId,
      world,
      base
    });
    await page.addScriptTag({
      path: path.resolve(__dirname, '../../../foundry-module/mission-panel.js')
    });
    await page.evaluate(() => {
      fixtureHooks.init();
      fixtureHooks.ready();
    });
  }
  const gmContext = await browser.newContext({
    reducedMotion: 'reduce'
  });
  const playerContext = await browser.newContext({
    reducedMotion: 'reduce',
    extraHTTPHeaders: {
      'X-Dev-User': 'browser-player@example.test'
    }
  });
  for (const context of [gmContext, playerContext]) await context.addInitScript(() => localStorage.setItem('lgpd_seen', 'true'));
  async function associate(page, context) {
    await page.getByRole('button', {
      name: 'Nimrod: missões e presença'
    }).click();
    await page.getByRole('button', {
      name: 'Associar minha conta',
      exact: true
    }).click();
    const url = await page.getByRole('link', {
      name: 'Abrir Nimrod para confirmar a associação'
    }).getAttribute('href');
    const approve = await context.newPage();
    await approve.goto(url);
    await approve.getByRole('button', {
      name: /Pular abertura/
    }).click();
    await approve.getByRole('button', {
      name: 'Confirmar associação com minha conta'
    }).click();
    await expect(approve.getByRole('status')).toContainText('Associação aprovada');
    await approve.close();
    await page.getByRole('button', {
      name: 'Concluir associação'
    }).click();
    await page.getByRole('combobox', {
      name: 'Missão Nimrod'
    }).selectOption(mission.id);
  }
  const gmPage = await setup(gmContext, true, 'foundry-gm');
  await associate(gmPage, gmContext);
  let attempts = 0;
  await gmPage.route(`**/api/nimrod/missions/${mission.id}/start`, async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Synthetic temporary failure'
      })
    });else await route.continue();
  });
  await gmPage.getByRole('button', {
    name: 'Iniciar sessão',
    exact: true
  }).click();
  await expect(gmPage.getByRole('button', {
    name: 'Sincronizar sessão ativa'
  })).toBeVisible();
  const sessionId = await gmPage.evaluate(() => fixtureLinked);
  expect(sessionId).toBeTruthy();
  expect(attempts).toBe(2);
  const playerPage = await setup(playerContext, false, 'foundry-player');
  await associate(playerPage, playerContext);
  await expect(playerPage.getByRole('button', {
    name: 'Iniciar sessão',
    exact: true
  })).toHaveCount(0);
  await expect(playerPage.getByText('Audit Player: conectado; presença não confirmada', {
    exact: false
  })).toBeVisible();
  await playerPage.getByRole('button', {
    name: 'Confirmar minha presença'
  }).click();
  await expect(playerPage.getByText('Audit Player: conectado; presença confirmada', {
    exact: false
  })).toBeVisible();
  // Simulate a browser reconnect using the Foundry client setting persisted by the fixture.
  await playerPage.reload();
  await install(playerPage, false, 'foundry-player');
  await playerPage.getByRole('button', {
    name: 'Nimrod: missões e presença'
  }).click();
  await playerPage.getByRole('combobox', {
    name: 'Missão Nimrod'
  }).selectOption(mission.id);
  await expect(playerPage.getByText('Audit Player: conectado; presença confirmada', {
    exact: false
  })).toBeVisible();
  gmPage.on('dialog', dialog => dialog.accept('GM verified correction'));
  await gmPage.getByRole('button', {
    name: 'Atualizar',
    exact: true
  }).click();
  await gmPage.getByRole('button', {
    name: 'Corrigir: retirar presença'
  }).click();
  await expect(gmPage.getByText('Audit Player: conectado; presença não confirmada', {
    exact: false
  })).toBeVisible();
  await gmPage.getByRole('button', {
    name: 'Encerrar sessão e pausar'
  }).click();
  await expect(gmPage.getByRole('button', {
    name: 'Iniciar sessão',
    exact: true
  })).toBeVisible();
  await gmPage.getByRole('button', {
    name: 'Iniciar sessão',
    exact: true
  }).click();
  await expect(gmPage.getByRole('button', {
    name: 'Sincronizar sessão ativa'
  })).toBeVisible();
  await gmPage.getByRole('button', {
    name: 'Concluir aventura'
  }).click();
  await expect(gmPage.getByRole('button', {
    name: 'Sincronizar sessão ativa'
  })).toHaveCount(0);
  await gmPage.screenshot({
    path: path.join(artifacts, 'foundry-panel-browser.png'),
    fullPage: true
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    result: 'passed',
    mode: 'Foundry API simulation + real Nimrod routes and PostgreSQL',
    startAttempts: attempts,
    checks: ['GM and player authenticated association', 'GM mission selection', 'temporary 503 retry', 'self attendance', 'reconnect', 'GM correction', 'pause', 'next session', 'finish'],
    pageErrors: errors.length
  }));
  await gmApi.dispose();
  await playerApi.dispose();
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
