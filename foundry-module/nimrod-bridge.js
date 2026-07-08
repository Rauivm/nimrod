/**
 * nimrod-bridge.js — Nimrod Bridge v3
 *
 * FLUXO:
 *   1. GM abre o mundo → módulo inicializa
 *   2. Verifica se há código salvo nas world settings (sessão já vinculada)
 *   3. Se não: gera novo código via POST /nimrod/handshake e exibe no painel
 *   4. Narrador copia o código e cola no Nimrod ao clicar "Iniciar campanha"
 *   5. Nimrod chama POST /missions/:id/start com o código → vincula sessão
 *   6. Módulo detecta via polling → ativa sync de eventos
 *   7. Ao encerrar no Nimrod → expires_at = now → módulo para eventos
 *
 * CÓDIGO NÃO EXPIRA AUTOMATICAMENTE:
 *   O código é válido durante toda a campanha. Se o Foundry reiniciar,
 *   o mesmo código é reutilizado (lido das world settings).
 *   Só é invalidado quando o narrador encerra a campanha no Nimrod.
 *
 * ESCOPO — o que este módulo NÃO faz:
 *   Presença (conectou/desconectou/reconectou/heartbeat/idle) NÃO é mais
 *   responsabilidade deste módulo. nimrod-bridge só entrega a sessão
 *   vinculada (activeSessionId na world setting); nimrod-session/
 *   PlayerHandlers.js assume a partir daí como única fonte de verdade
 *   para presença. Isso evita duas implementações independentes
 *   registrando o mesmo tipo de fato.
 */

const MODULE_ID  = 'nimrod-bridge';
const POLL_MS    = 5_000;
const STATUS_CHECK_MS = 30_000;

const CALENDAR_CHECK_MS = 60_000; // estação muda no máximo 1x por sessão — não precisa ser mais frequente que isso

// ─── Clima por estação (FXMaster) ──────────────────────────────────────────────
//
// Mapa estação → efeito de clima. Chaves batem com as retornadas por
// GET /nimrod/calendar/status (WINTER/SPRING/SUMMER/AUTUMN — as mesmas
// chaves usadas em frontend/src/config/calendarSeasons.js e season_effects
// no Nimrod).
//
// Para trocar o clima de uma estação, edite só este objeto — nenhuma outra
// parte do código precisa mudar. `particles` segue o formato da Effects API
// do FXMaster (FXMASTER.api.effects.play): array de { type, options }.
// Tipos nativos disponíveis: autumnleaves, bats, birds, bubbles, clouds,
// crows, eagles, embers, fog, hail, rain, rats, snow, snowstorm, spiders,
// stars (rode `Object.keys(CONFIG.fxmaster.particleEffects)` no console pra
// ver a lista completa da versão instalada, incluindo FXMaster+ se ativo).
const SEASON_WEATHER = {
  WINTER: {
    particles: [
      { type: 'snow', options: { density: 0.35, speed: 0.8 } },
    ],
  },
  SPRING: {
    particles: [
      { type: 'rain', options: { density: 0.15, speed: 1.0 } },
    ],
  },
  SUMMER: {
    particles: [
      { type: 'rain', options: { density: 0, speed: 0 } },
    ],
  },
  AUTUMN: {
    particles: [
      { type: 'autumnleaves', options: { density: 0.3, speed: 0.7 } },
    ],
  },
};


// ─── Settings ────────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'nimrodUrl', {
    name: 'URL do Nimrod', hint: 'Ex: https://nimrod.meusite.com',
    scope: 'world', config: true, type: String, default: '',
  });
  game.settings.register(MODULE_ID, 'nimrodApiKey', {
    name: 'API Key do Nimrod', hint: 'Chave FOUNDRY_API_KEY do servidor Nimrod.',
    scope: 'world', config: true, type: String, default: '',
  });
  // Código atual — persiste entre reloads do mundo
  game.settings.register(MODULE_ID, 'handshakeCode', {
    name: 'Código de handshake (auto)', scope: 'world', config: false, type: String, default: '',
  });
  // SessionId ativo — propagado ao nimrod-session
  game.settings.register(MODULE_ID, 'activeSessionId', {
    name: 'Sessão Ativa (auto)', scope: 'world', config: false, type: String, default: '',
  });
    game.settings.register(MODULE_ID, 'autoWeather', {
    name: 'Trocar clima automaticamente por estação',
    hint: 'Usa o FXMaster para aplicar o clima da estação atual do Nimrod quando ela mudar. Requer o módulo FXMaster ativo.',
    scope: 'world', config: true, type: Boolean, default: true,
  });

});

// ─── Estado ───────────────────────────────────────────────────────────────────

const State = {
  code:        null,
  sessionId:   null,
  linked:      false,
  pollTimer:   null,
  watchTimer:  null,
  panel:       null,
  calendarTimer:   null,
  lastSeasonKey:   null,
  weatherEffectIds: null, // { particles: [...], filters: [...] } — retornado pelo FXMaster ao aplicar

};

// ─── HTTP ─────────────────────────────────────────────────────────────────────

const base = () => (game.settings.get(MODULE_ID, 'nimrodUrl') ?? '').replace(/\/$/, '');
const key  = () => game.settings.get(MODULE_ID, 'nimrodApiKey') ?? '';
const hdrs = () => ({ 'Content-Type': 'application/json', 'X-Nimrod-Key': key() });

async function nPost(path, body) {
  const res = await fetch(`${base()}${path}`, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? `HTTP ${res.status}`); }
  return res.json();
}

async function nGet(path) {
  const res = await fetch(`${base()}${path}`, { headers: hdrs() });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? `HTTP ${res.status}`); }
  return res.json();
}

// ─── Painel UI ────────────────────────────────────────────────────────────────

function renderPanel() {
  if (!game.user.isGM) return;
  State.panel?.remove();

  const panel = document.createElement('div');
  panel.id = 'nb-panel';

  if (State.linked) {
    panel.innerHTML = `
      <div class="nb-row">
        <span class="nb-icon">🔗</span>
        <div class="nb-info">
          <div class="nb-label">Nimrod vinculado</div>
          <div class="nb-sub">${State.sessionId?.slice(0,8)}…</div>
        </div>
        <button class="nb-x" title="Fechar">×</button>
      </div>`;
  } else {
    const code = State.code ?? '–';
    panel.innerHTML = `
      <div class="nb-header">
        <span class="nb-icon">🎲</span>
        <span class="nb-label">Nimrod — Código</span>
        <button class="nb-x" title="Fechar">×</button>
      </div>
      <div class="nb-code-row">
        <span class="nb-code" id="nb-code-text">${code}</span>
        <button class="nb-copy" title="Copiar código" id="nb-copy-btn">📋</button>
      </div>
      <div class="nb-hint">Cole este código no Nimrod ao iniciar a campanha</div>
      <div class="nb-actions">
        <button class="nb-btn" id="nb-new-btn">↺ Novo código</button>
      </div>
      <div class="nb-divider"></div>
      <div class="nb-sub" style="margin-bottom:4px">Ou informe um código existente:</div>
      <div class="nb-row-gap">
        <input id="nb-manual-input" class="nb-input" placeholder="XXXXXXX" maxlength="7" />
        <button class="nb-btn" id="nb-use-btn">Usar</button>
      </div>`;
  }

  const style = document.createElement('style');
  style.id = 'nb-style';
  style.textContent = `
    #nb-panel { position:fixed; bottom:16px; right:16px; z-index:9999; background:#1a1008; border:1px solid #7a5c18; border-radius:8px; padding:12px 14px; box-shadow:0 8px 32px rgba(0,0,0,.7); font-family:sans-serif; color:#e8c870; width:240px; user-select:none; }
    #nb-panel .nb-header { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
    #nb-panel .nb-row { display:flex; align-items:center; gap:10px; }
    #nb-panel .nb-row-gap { display:flex; gap:6px; align-items:center; }
    #nb-panel .nb-icon { font-size:18px; flex-shrink:0; }
    #nb-panel .nb-label { font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; flex:1; }
    #nb-panel .nb-info { flex:1; }
    #nb-panel .nb-sub { font-size:11px; color:#a08040; }
    #nb-panel .nb-hint { font-size:11px; color:#a08040; text-align:center; margin:4px 0; }
    #nb-panel .nb-code-row { display:flex; align-items:center; justify-content:center; gap:8px; background:rgba(255,255,255,.04); border-radius:4px; padding:6px 8px; margin-bottom:4px; }
    #nb-panel .nb-code { font-size:28px; font-weight:900; letter-spacing:6px; font-family:'Courier New',monospace; color:#f0d080; }
    #nb-panel .nb-copy { background:rgba(122,92,24,.2); border:1px solid #7a5c18; color:#c9a84c; border-radius:4px; padding:4px 7px; cursor:pointer; font-size:14px; transition:background .15s; }
    #nb-panel .nb-copy:hover { background:rgba(122,92,24,.4); }
    #nb-panel .nb-copy.nb-copied { color:#4a9a6a; }
    #nb-panel .nb-actions { display:flex; gap:6px; justify-content:center; margin:6px 0 2px; }
    #nb-panel .nb-btn { background:rgba(122,92,24,.2); border:1px solid #7a5c18; color:#c9a84c; font-size:11px; padding:4px 10px; border-radius:4px; cursor:pointer; transition:background .15s; }
    #nb-panel .nb-btn:hover { background:rgba(122,92,24,.4); }
    #nb-panel .nb-divider { border:none; border-top:1px solid #3a2810; margin:8px 0 6px; }
    #nb-panel .nb-input { flex:1; background:#2a1a08; border:1px solid #7a5c18; color:#e8c870; border-radius:4px; padding:4px 8px; font-size:13px; font-family:'Courier New',monospace; letter-spacing:2px; text-transform:uppercase; outline:none; }
    #nb-panel .nb-x { background:none; border:none; color:#806040; font-size:18px; cursor:pointer; padding:0; margin-left:auto; line-height:1; }
    #nb-panel .nb-x:hover { color:#e8c870; }
  `;

  document.getElementById('nb-style')?.remove();
  document.head.appendChild(style);
  document.body.appendChild(panel);
  State.panel = panel;

  // Eventos
  panel.querySelector('.nb-x')?.addEventListener('click', () => panel.remove());

  const copyBtn = panel.querySelector('#nb-copy-btn');
  if (copyBtn && State.code) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(State.code);
        copyBtn.textContent = '✅';
        copyBtn.classList.add('nb-copied');
        setTimeout(() => { copyBtn.textContent = '📋'; copyBtn.classList.remove('nb-copied'); }, 2000);
      } catch { copyBtn.title = 'Copie manualmente: ' + State.code; }
    });
  }

  panel.querySelector('#nb-new-btn')?.addEventListener('click', () => initiateHandshake(true));

  const useBtn = panel.querySelector('#nb-use-btn');
  useBtn?.addEventListener('click', async () => {
    const input = panel.querySelector('#nb-manual-input');
    const val = input?.value?.trim().toUpperCase();
    if (!val || val.length < 4) return;
    await setCodeAndSave(val);
    startPolling();
    renderPanel();
  });

  panel.querySelector('#nb-manual-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') useBtn?.click();
  });
}

// ─── Gestão do código ─────────────────────────────────────────────────────────

async function setCodeAndSave(code) {
  State.code = code;
  try { await game.settings.set(MODULE_ID, 'handshakeCode', code); } catch {}
}

async function initiateHandshake(forceNew = false) {
  if (!game.user.isGM) return;
  if (!base() || !key()) {
    ui.notifications?.warn(`[${MODULE_ID}] Configure URL e API Key nas Configurações do Módulo.`);
    renderPanel(); return;
  }

  // Se já há código salvo nas settings e não forçando novo, reutiliza
  if (!forceNew) {
    const saved = game.settings.get(MODULE_ID, 'handshakeCode') || '';
    if (saved) {
      State.code = saved;
      console.info(`%c[${MODULE_ID}] Reutilizando código salvo: ${saved}`, 'color:#c9a84c');
      renderPanel();
      startPolling();
      return;
    }
  }

  // Para polling anterior
  if (State.pollTimer) { clearInterval(State.pollTimer); State.pollTimer = null; }

  try {
    const worldState = collectWorld();
    const data = await nPost('/nimrod/handshake', worldState);
    await setCodeAndSave(data.code);
    console.info(`%c[${MODULE_ID}] Novo código: ${data.code}`, 'color:#c9a84c;font-weight:bold');
    renderPanel();
    startPolling();
  } catch (err) {
    console.error(`[${MODULE_ID}] Handshake falhou:`, err.message);
    ui.notifications?.error(`[${MODULE_ID}] Falha ao conectar ao Nimrod: ${err.message}`);
    renderPanel();
  }
}

function collectWorld() {
  const players = (game.users ?? []).filter(u => u.active).map(u => ({
    foundryUserId: u.id, foundryName: u.name, isGM: u.isGM,
    characterName: u.character?.name ?? null, actorId: u.character?.id ?? null,
    hp: u.character?.system?.attributes?.hp?.value ?? null,
  }));
  const tokens = (canvas?.tokens?.placeables ?? []).map(t => ({
    tokenId: t.id, actorId: t.actor?.id ?? null, actorName: t.actor?.name ?? t.name,
    hp: t.actor?.system?.attributes?.hp?.value ?? null, isPC: t.actor?.type === 'character',
  }));
  return { worldId: game.world?.id ?? 'unknown', gmName: game.user?.name ?? null, players, tokens };
}

// ─── Polling ─────────────────────────────────────────────────────────────────

async function pollStatus() {
  if (!State.code || State.linked) return;
  try {
    const data = await nGet(`/nimrod/handshake/status?code=${encodeURIComponent(State.code)}`);
    if (data.linked && data.sessionId) onLinked(data.sessionId);
  } catch (err) {
    // 404 pode significar código inválido — não para o polling (pode ter sido
    // gerado um novo código no servidor)
    if (err.message.includes('404')) {
      console.warn(`[${MODULE_ID}] Código não encontrado no servidor. Gere um novo se necessário.`);
    }
  }
}

function startPolling() {
  if (State.pollTimer) clearInterval(State.pollTimer);
  State.pollTimer = setInterval(pollStatus, POLL_MS);
}

// ─── Vinculação ───────────────────────────────────────────────────────────────

async function onLinked(sessionId) {
  clearInterval(State.pollTimer); State.pollTimer = null;
  State.linked = true; State.sessionId = sessionId;
  console.info(`%c[${MODULE_ID}] ✅ Sessão vinculada: ${sessionId}`, 'color:#4a9a6a;font-weight:bold');

  try {
    if (game.settings.settings?.has('nimrod-session.activeSessionId')) {
      await game.settings.set('nimrod-session', 'activeSessionId', sessionId);
    }
    await game.settings.set(MODULE_ID, 'activeSessionId', sessionId);
  } catch {}

  renderPanel();
  ui.notifications?.info(`[${MODULE_ID}] Sessão Nimrod vinculada!`);
  //await syncPresence(sessionId);
  //registerPresenceHooks(sessionId);
  startSessionWatcher(sessionId);
  startCalendarWatcher();
}

// ─── Presença ────────────────────────────────────────────────────────────────

async function sendPresence(sessionId, type, user, actor) {
  if (!base() || !key() || !sessionId) return;
  try {
    await fetch(`${base()}/nimrod/session/presence`, {
      method: 'POST', headers: hdrs(), keepalive: type === 'leave',
      body: JSON.stringify({
        sessionId, eventType: type,
        foundryUserId: user.id, foundryName: user.name,
        characterName: actor?.name ?? null, actorId: actor?.id ?? null,
        hp: actor?.system?.attributes?.hp?.value ?? null,
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch (e) { console.warn(`[${MODULE_ID}] Presença (${type}):`, e.message); }
}

async function syncPresence(sessionId) {
  for (const u of (game.users ?? [])) {
    if (!u.active) continue;
    await sendPresence(sessionId, 'enter', u, u.character);
  }
}

function registerPresenceHooks(sessionId) {
  Hooks.on('userConnected', async (user, connected) => {
    if (!State.linked || State.sessionId !== sessionId) return;
    await sendPresence(sessionId, connected ? 'enter' : 'leave', user, user.character);
  });
  Hooks.on('updateUser', async (user, changes) => {
    if (!State.linked || State.sessionId !== sessionId || !('character' in (changes ?? {}))) return;
    const actor = game.actors?.get(changes.character);
    await sendPresence(sessionId, 'reconnect', user, actor ?? null);
  });
  window.addEventListener('beforeunload', () => {
    sendPresence(sessionId, 'leave', game.user, game.user?.character ?? null);
    // Limpa settings ao sair (sessão encerrada externamente)
    // Mantém o código — pode ser reutilizado na próxima abertura
  }, { once: true });
}

// ─── Clima por estação ──────────────────────────────────────────────────────

/**
 * Troca o clima da cena atual pro clima configurado da estação, via FXMaster.
 * Só GM aplica (efeitos de cena exigem permissão de GM no FXMaster de qualquer
 * forma). Se o FXMaster não estiver ativo, ou se a troca automática estiver
 * desligada nas configurações do módulo, não faz nada.
 */
async function applySeasonWeather(seasonKey) {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, 'autoWeather')) return;

  if (typeof FXMASTER === 'undefined' || !FXMASTER?.api?.effects) {
    console.warn(`[${MODULE_ID}] FXMaster não encontrado.`);
    return;
  }

  const weather = SEASON_WEATHER[seasonKey];
  if (!weather) {
    console.warn(`[${MODULE_ID}] Nenhum clima configurado para a estação "${seasonKey}".`);
    return;
  }

  try {
    // Remove todos os efeitos registrados na cena
    const effects = canvas.scene.getFlag("fxmaster", "effects") ?? {};
    const filters = canvas.scene.getFlag("fxmaster", "filters") ?? {};

    const particleIds = Object.keys(effects);
    const filterIds = Object.keys(filters);

    if (particleIds.length || filterIds.length) {
      await FXMASTER.api.effects.stop({
        particles: particleIds,
        filters: filterIds,
        skipFading: true,
      });
    }

    // Aplica o clima da estação
    State.weatherEffectIds = await FXMASTER.api.effects.play({
      particles: weather.particles ?? [],
      filters: weather.filters ?? [],
    });

    console.info(
      `%c[${MODULE_ID}] Clima atualizado: ${seasonKey}`,
      "color:#4a9a6a;font-weight:bold"
    );
  } catch (err) {
    console.warn(`[${MODULE_ID}] Falha ao aplicar clima (${seasonKey}):`, err);
  }
}

async function clearAllWeather() {
  if (typeof FXMASTER === 'undefined' || !canvas?.scene) return;

  const effects = canvas.scene.getFlag("fxmaster", "effects") ?? {};
  const filters = canvas.scene.getFlag("fxmaster", "filters") ?? {};

  const particleIds = Object.keys(effects);
  const filterIds = Object.keys(filters);

  if (!particleIds.length && !filterIds.length) return;

  await FXMASTER.api.effects.stop({
    particles: particleIds,
    filters: filterIds,
    skipFading: true,
  });

  State.weatherEffectIds = null;
}

/**
 * Consulta a estação atual no Nimrod. Se mudou desde a última checagem,
 * aplica o clima novo. Na primeira checagem após vincular a sessão, também
 * aplica (garante que o clima já entre correto ao abrir o mundo).
 */
async function pollCalendar() {
  if (!State.linked) return;
  try {
    const data = await nGet('/nimrod/calendar/status');
    if (!data.seasonKey || data.seasonKey === State.lastSeasonKey) return;

    const changed = State.lastSeasonKey !== null;
    State.lastSeasonKey = data.seasonKey;
    await applySeasonWeather(data.seasonKey);

    if (changed && game.user.isGM) {
      ui.notifications?.info(`[${MODULE_ID}] Estação mudou para ${data.season} — clima atualizado.`);
    }
  } catch (err) {
    console.warn(`[${MODULE_ID}] Falha ao consultar calendário:`, err.message);
  }
}

function startCalendarWatcher() {
  if (State.calendarTimer) clearInterval(State.calendarTimer);
  pollCalendar(); // aplica de imediato, não espera o primeiro intervalo
  State.calendarTimer = setInterval(pollCalendar, CALENDAR_CHECK_MS);
}

function stopCalendarWatcher() {
  if (State.calendarTimer) { clearInterval(State.calendarTimer); State.calendarTimer = null; }
  State.lastSeasonKey = null;
}



// ─── Watcher de encerramento ─────────────────────────────────────────────────

function startSessionWatcher(sessionId) {
  if (State.watchTimer) clearInterval(State.watchTimer);
  State.watchTimer = setInterval(async () => {
    if (!State.linked || State.sessionId !== sessionId) { clearInterval(State.watchTimer); return; }
    try {
      const data = await nGet(`/nimrod/session/status?sessionId=${sessionId}`);
      if (data.status === 'closed') {
        clearInterval(State.watchTimer);
        onSessionClosed(sessionId);
      }
    } catch { /* silencioso */ }
  }, STATUS_CHECK_MS);
}

function onSessionClosed(sessionId) {
  console.info(`%c[${MODULE_ID}] Sessão encerrada pelo Nimrod.`, 'color:#c04040');
  State.linked = false; State.sessionId = null;
  stopCalendarWatcher();

  // Limpa código salvo — campanha encerrada
  game.settings.set(MODULE_ID, 'handshakeCode', '').catch(() => {});
  game.settings.set(MODULE_ID, 'activeSessionId', '').catch(() => {});
  if (game.settings.settings?.has('nimrod-session.activeSessionId')) {
    game.settings.set('nimrod-session', 'activeSessionId', '').catch(() => {});
  }
  ui.notifications?.warn(`[${MODULE_ID}] A campanha foi encerrada pelo narrador no Nimrod.`);
  State.code = null;
  renderPanel();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Hooks.once('ready', async () => {
  if (!game.user.isGM) {
    console.info(`[${MODULE_ID}] Não é GM — aguardando sessionId do GM.`);
    return;
  }

  if (!base() || !key()) {
    console.info(`[${MODULE_ID}] URL/API Key não configuradas — aguardando configuração.`);
    State.linked = false;
    renderPanel();
    return;
  }

  // Verifica se há sessão salva — mas NÃO confia cegamente: valida contra o
  // backend antes de marcar como vinculada. Uma setting "presa" de uma sessão
  // já encerrada não deve fazer o módulo abrir já como "vinculado".
  const savedSession = game.settings.get(MODULE_ID, 'activeSessionId') || '';
  const savedCode     = game.settings.get(MODULE_ID, 'handshakeCode')    || '';

  if (savedSession) {
    try {
      const data = await nGet(`/nimrod/session/status?sessionId=${savedSession}`);
      if (data.status === 'open') {
        // Sessão realmente ainda aberta no Nimrod — restaura normalmente
        State.linked    = true;
        State.sessionId = savedSession;
        State.code      = savedCode || null;
        console.info(`%c[${MODULE_ID}] Sessão ativa restaurada: ${savedSession}`, 'color:#4a9a6a');
        renderPanel();
//        await syncPresence(savedSession);
//        registerPresenceHooks(savedSession);
        startSessionWatcher(savedSession);
        startCalendarWatcher();
        return;
      }
      console.info(`[${MODULE_ID}] Sessão salva (${savedSession}) não está mais aberta (status: ${data.status}) — limpando e reiniciando handshake.`);
    } catch (err) {
      console.warn(`[${MODULE_ID}] Não foi possível validar sessão salva: ${err.message} — limpando e reiniciando handshake.`);
    }

    // Sessão salva é inválida/encerrada — limpa o estado preso
    await game.settings.set(MODULE_ID, 'activeSessionId', '').catch(() => {});
    State.linked    = false;
    State.sessionId = null;
  }

  console.info(`%c[${MODULE_ID}] Inicializando handshake…`, 'color:#c9a84c;font-weight:bold');
  await initiateHandshake(false);
});