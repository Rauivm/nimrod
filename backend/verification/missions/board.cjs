// Requires an externally available Playwright runtime; no production credentials.
const path = require('node:path');
const artifacts = process.env.MISSION_TEST_ARTIFACTS || path.resolve(__dirname, '../../../node_modules/.cache/nimrod-audit');
require('node:fs').mkdirSync(artifacts, {
  recursive: true
});
const {
  chromium,
  expect
} = require('playwright/test');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true
  });
  const errors = [];
  const gm = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },
    reducedMotion: 'reduce'
  });
  const player = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },
    extraHTTPHeaders: {
      'X-Dev-User': 'browser-player@example.test'
    },
    reducedMotion: 'reduce'
  });
  for (const c of [gm, player]) await c.addInitScript(() => localStorage.setItem('lgpd_seen', 'true'));
  const a = await gm.newPage();
  const b = await player.newPage();
  for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));
  await a.goto('http://127.0.0.1:55439/missions');
  await a.getByRole('button', {
    name: /Pular abertura/
  }).click();
  await a.getByRole('button', {
    name: 'Nova missão / aviso'
  }).click();
  const modal = a.locator('.modal');
  const name = `Browser workflow ${Date.now()}`;
  await modal.locator('input').first().fill(name);
  await modal.locator('textarea').fill('Browser validation mission');
  const numbers = modal.locator('input[type=number]');
  for (const [i, value] of ['1', '5', '1', '2', '2'].entries()) await numbers.nth(i).fill(value);
  await modal.getByLabel('Inscrições sujeitas à aprovação').check();
  await modal.getByRole('button', {
    name: 'Criar Missão',
    exact: true
  }).click();
  await expect(modal).toHaveCount(0);
  let card = a.locator('.poster-wrap').filter({
    hasText: name
  });
  await card.getByTitle('Ver detalhes').click();
  await card.getByRole('button', {
    name: 'Assumir narração'
  }).click();
  await expect(card.getByText('Narrador designado', {
    exact: false
  })).toBeVisible();
  await b.goto('http://127.0.0.1:55439/missions');
  await b.getByRole('button', {
    name: /Pular abertura/
  }).click();
  const playerCard = b.locator('.poster-wrap').filter({
    hasText: name
  });
  await playerCard.getByTitle('Ver detalhes').click();
  await playerCard.getByRole('button', {
    name: 'Solicitar inscrição',
    exact: true
  }).click();
  await b.getByRole('button', {
    name: 'Jogador (sem personagem)',
    exact: false
  }).click();
  await b.getByRole('button', {
    name: 'Entrar como solicitante'
  }).click();
  await expect(playerCard.getByText('Aguardando aprovação', {
    exact: true
  })).toBeVisible();
  await expect(card.getByRole('button', {
    name: 'Aprovar',
    exact: true
  })).toBeVisible();
  await card.getByRole('button', {
    name: 'Aprovar',
    exact: true
  }).click();
  await expect(playerCard.getByText('Aguardando aprovação', {
    exact: true
  })).toHaveCount(0);
  await card.getByRole('button', {
    name: 'Iniciar sessão',
    exact: true
  }).click();
  await expect(card.getByText('Sessão ativa · Inscrições encerradas', {
    exact: false
  })).toBeVisible();
  await playerCard.getByRole('button', {
    name: 'Lista de presença'
  }).click();
  await playerCard.getByRole('button', {
    name: 'Confirmar minha presença'
  }).click();
  await expect(playerCard.getByText('presença confirmada', {
    exact: false
  })).toBeVisible();
  await card.getByRole('button', {
    name: 'Encerrar sessão e pausar'
  }).click();
  await expect(card.getByText('Aguardando próxima sessão', {
    exact: false
  })).toBeVisible();
  await card.getByRole('button', {
    name: 'Iniciar próxima sessão'
  }).click();
  await expect(card.getByText('Sessão ativa · Inscrições encerradas', {
    exact: false
  })).toBeVisible();
  a.on('dialog', dialog => dialog.accept());
  await card.getByRole('button', {
    name: 'Concluir aventura'
  }).click();
  await expect(card.getByText('Concluída · Inscrições encerradas', {
    exact: false
  })).toBeVisible();
  await card.getByLabel('Motivo administrativo', {
    exact: true
  }).fill('Validation reopen');
  await card.getByRole('button', {
    name: 'Reabrir aventura'
  }).click();
  await expect(card.getByText('Aguardando próxima sessão', {
    exact: false
  })).toBeVisible();
  await a.screenshot({
    path: path.join(artifacts, 'mission-board-browser.png'),
    fullPage: true
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    workflow: 'create, self-designate, request, approve, start, confirm, pause, next session, finish, reopen',
    pageErrors: errors.length,
    result: 'passed'
  }));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
