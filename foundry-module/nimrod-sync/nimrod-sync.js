// nimrod-sync.js
import { SyncCollector } from './collector.js';

async function syncAllActors() {
  const actors = game.actors?.filter(
    a => a.type === 'character' && a.hasPlayerOwner
  ) ?? [];

  if (!actors.length) {
    console.log('[nimrod-sync] No player-owned characters found.');
    return;
  }

  for (const actor of actors) {
    SyncCollector.collect(actor);
  }

  // Cancela o debounce pendente e faz flush imediato
  SyncCollector.cancelPendingFlush();
  await SyncCollector.flush();

  console.log(`[nimrod-sync] Full sync triggered for ${actors.length} actors.`);
}

Hooks.once('init', () => {
  game.settings.register('nimrod-sync', 'bridgeUrl', {
    name: 'Bridge URL',
    hint: 'URL do Nimrod Bridge. Em dev local: http://localhost:8081/bridge. Em produção: https://meu-servidor.com/bridge',
    scope: 'world',
    config: true,
    type: String,
    // ── CORREÇÃO CORS ──────────────────────────────────────────────────────────
    // O default NUNCA deve ser localhost:porta-diferente quando o Foundry roda
    // em localhost:30000 — isso viola CORS (cross-origin).
    //
    // Padrão correto para dev local: o nginx está em localhost:8081,
    // mas o browser do Foundry está em localhost:30000, então a chamada
    // para localhost:8081 é cross-origin e o CORS falha.
    //
    // A solução é configurar o valor manualmente nas settings do módulo:
    //   → Dev local:  http://localhost:8081/bridge
    //     (funciona se o nginx servir o header CORS — o bridge já retorna `origin: true`)
    //   → Produção:   https://meu-servidor.com/bridge
    //     (recomendado: usar a URL pública para evitar qualquer problema de CORS)
    //
    // O default vazio força o GM a configurar explicitamente, evitando falhas silenciosas.
    default: '',
  });
});

Hooks.once('ready', async () => {
  console.log('[nimrod-sync] Ready hook fired');

  // ── Sync inicial ao carregar o mundo ──────────────────────────────────────
  await syncAllActors();

  // ── Hooks incrementais ────────────────────────────────────────────────────
  // updateActor recebe (actor, changes, options, userId) no v13/v14

  
  Hooks.on('createActor', (actor) => {
    if (actor.type !== 'character' || !actor.hasPlayerOwner) return;
    SyncCollector.collect(actor);
  });

  Hooks.on('updateActor', (actor, _changes, _options, _userId) => {
    if (actor.type !== 'character' || !actor.hasPlayerOwner) return;
    SyncCollector.collect(actor);
  });

  // ── Botão na barra de cena (v13/v14: controls é um OBJETO, não array) ─────
  //
  // BREAKING CHANGE v13: controls.push() não existe mais.
  // A forma correta é: controls['nimrod-sync'] = { ... }
  // tools também é um objeto keyed por nome, não array.
  // O campo "layer" foi removido.
  //


  Hooks.on('getSceneControlButtons', (controls) => {
    controls['nimrod-sync'] = {
      name:  'nimrod-sync',
      title: 'Nimrod Sync',
      icon:  'fa-solid fa-dragon',
      order: 99,
      tools: {
        'sync-all': {
          name:    'sync-all',
          title:   'Sync All Actors',
          icon:    'fa-solid fa-rotate',
          button:  true,
          onClick: async () => {
            const url = game.settings.get('nimrod-sync', 'bridgeUrl');
            if (!url) {
              ui.notifications.error('[Nimrod] Bridge URL não configurada. Configure em Configurações do Módulo → nimrod-sync.');
              return;
            }
            ui.notifications.info('[Nimrod] Starting full sync...');
            await syncAllActors();
            ui.notifications.info('[Nimrod] Full sync completed.');
          },
        },
        'config-help': {
          name:    'config-help',
          title:   'Ajuda: Configurar Bridge URL',
          icon:    'fa-solid fa-circle-question',
          button:  true,
          onClick: () => {
            const url = game.settings.get('nimrod-sync', 'bridgeUrl');
            const msg = url
              ? `Bridge URL configurada: ${url}`
              : 'Bridge URL NÃO configurada. Vá em Configurações do Módulo → nimrod-sync → Bridge URL e configure:\n  Dev: http://localhost:8081/bridge\n  Prod: https://meu-servidor.com/bridge';
            ui.notifications[url ? 'info' : 'warn'](msg);
            console.log('[nimrod-sync] Bridge URL atual:', url || '(não configurada)');
          },
        },
      },
    };
  });

  // ── Reconciliação periódica a cada 10 minutos ─────────────────────────────
  setInterval(() => syncAllActors(), 1000 * 60 * 10);

  // ── Expõe API global para debugging no console ────────────────────────────
  game.nimrodSync = { syncAllActors };

  // ── Avisa se a bridge URL não está configurada ────────────────────────────
  const bridgeUrl = game.settings.get('nimrod-sync', 'bridgeUrl');
  if (!bridgeUrl) {
    ui.notifications.warn(
      '[Nimrod Sync] Bridge URL não configurada. ' +
      'Configure em Configurações do Módulo → nimrod-sync → Bridge URL. ' +
      'Valor esperado: http://localhost:8081/bridge (dev) ou https://meu-servidor.com/bridge (prod).'
    );
    console.warn('[nimrod-sync] Bridge URL não configurada — sync desativado até configuração.');
  }

  console.log('[nimrod-sync] Collector active — hooks registered');
  console.log('[nimrod-sync] Bridge URL:', bridgeUrl || '(não configurada — configure nas settings do módulo)');
});
