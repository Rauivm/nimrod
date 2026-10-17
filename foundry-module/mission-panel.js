/* Extends nimrod-bridge; keeps the existing handshake and event modules. */
(() => {
  const moduleId = 'nimrod-bridge';
  let dialog,
    selected = null,
    pollTimer = null,
    pendingProof = null;
  let renderVersion=0;
  const settings = () => game.settings.get(moduleId, 'missionIdentity') || {};
  const currentIdentity = () => {
    const value = settings();
    return value.worldId === game.world.id && value.foundryUserId === game.user.id ? value : {};
  };
  const baseUrl = () => String(game.settings.get(moduleId, 'nimrodUrl') || '').replace(/\/$/, '');
  const apiKey = () => game.settings.get(moduleId, 'nimrodApiKey') || '';
  async function request(path, body, options = {}) {
    const token = currentIdentity().token;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${baseUrl()}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? {
              Authorization: `Bearer ${token}`
            } : {
              'X-Nimrod-Key': apiKey()
            })
          },
          ...(body === undefined ? {} : {
            body: JSON.stringify(body)
          }),
          ...options
        });
        const data = await res.json();
        if (res.status === 401 && token) await game.settings.set(moduleId, 'missionIdentity', {});
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {
          status: res.status
        });
        return data;
      } catch (error) {
        if (error.status < 500 || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    parent?.appendChild(node);
    return node;
  }
  function button(label, parent, action, disabled = false) {
    const node = element('button', label, parent);
    node.type = 'button';
    node.style.cssText = 'width:auto;margin:4px 6px 4px 0;padding:7px 12px;background:#49351b;color:#f6e4b8;border:1px solid #9a7838;border-radius:4px;cursor:pointer;font:inherit;';
    node.disabled = disabled;
    node.addEventListener('click', async () => {
      node.disabled = true;
      try {
        await action();
      } catch (error) {
        message(error.message);
      } finally {
        node.disabled = disabled;
      }
    });
    return node;
  }
  function message(text) {
    if (dialog?.open) {
      const node = dialog.querySelector('[role=status]');
      if (node) node.textContent = text;
    }
  }
  async function associate() {
    const proof = await request('/nimrod/identity/proofs', {
      worldId: game.world.id,
      foundryUserId: game.user.id,
      isGM: Boolean(game.user.isGM)
    });
    pendingProof = proof;
    // Only the opaque proof ID leaves Foundry. The redemption secret stays in this client.
    const url = new URL(`${baseUrl().replace(/\/api$/, '')}/foundry-connect`);
    url.searchParams.set('proofId', proof.proofId);
    const link = element('a', 'Abrir Nimrod para confirmar a associação', dialog.querySelector('.nm-content'));
    link.href = url.toString();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    message('Confirme sua conta no Nimrod e clique em Concluir associação.');
  }
  async function completeAssociation() {
    if (!pendingProof) throw new Error('Inicie uma associação neste painel primeiro.');
    const result = await request(`/nimrod/identity/${pendingProof.proofId}/redeem`, {
      secret: pendingProof.secret
    });
    if (result.pending) throw new Error('A confirmação no Nimrod ainda está pendente.');
    await game.settings.set(moduleId, 'missionIdentity', {
      token: result.token,
      userId: result.userId,
      worldId: game.world.id,
      foundryUserId: game.user.id
    });
    pendingProof = null;
    await render();
  }
  async function render() {
    const version=++renderVersion;
    message('');
    const content = dialog.querySelector('.nm-content');
    content.replaceChildren();
    if (!currentIdentity().token) {
      element('p', 'Associe sua conta autenticada do Nimrod. Nomes de jogadores e personagens não comprovam identidade.', content);
      button('Associar minha conta', content, associate);
      button('Concluir associação', content, completeAssociation);
      element('p', 'O código do painel antigo continua disponível como alternativa de vinculação; ele não concede administração.', content);
      return;
    }
    const missions = await request('/nimrod/missions');
    if(version!==renderVersion)return;
    if (!missions.length) {
      element('p', 'Nenhuma missão associada à sua conta. Confirme sua inscrição ou aceite um convite de narração no Nimrod.', content);
      return;
    }
    const select = element('select', null, content);
    select.setAttribute('aria-label', 'Missão Nimrod');
    for (const mission of missions) {
      const option = element('option', `${mission.title} — ${mission.status}`, select);
      option.value = mission.id;
    }
    if (selected && missions.some(m => m.id === selected)) select.value = selected;
    const details = element('div', null, content);
    let showVersion=0;
    async function show() {
      const showing=++showVersion;
      const current=()=>version===renderVersion && showing===showVersion;
      selected = select.value;
      details.replaceChildren();
      const mission = missions.find(m => m.id === selected);
      if (!mission) return;
      element('h3', mission.title, details);
      element('p', mission.description, details);
      element('p', `Jogadores: ${mission.min_players ?? '?'}–${mission.max_players}; níveis: ${mission.min_level ?? '?'}–${mission.max_level ?? '?'}`, details);
      const list = element('ul', null, details);
      for (const p of mission.participants) element('li', `${p.name}: ${p.approvalStatus === 'APPROVED' ? p.type === 'PLAYER' ? 'confirmado' : 'reserva' : 'aguardando aprovação'}`, list);
      if (game.user.isGM && mission.canManage && ['OPEN', 'CLOSED', 'PAUSED', 'RUNNING'].includes(mission.status)) {
        button(mission.active_session_id ? 'Sincronizar sessão ativa' : 'Iniciar sessão', details, async () => {
          const result = await request(`/nimrod/missions/${mission.id}/start`, {});
          // Existing bridge propagates session to nimrod-session, with real Foundry GM permission.
          if (typeof onLinked === 'function') await onLinked(result.session.id);
          await render();
        });
      }
      if (mission.active_session_id) {
        const sessionId = mission.active_session_id;
        if (game.user.isGM && mission.canManage) {
          button('Encerrar sessão e pausar', details, async () => {
            await request(`/nimrod/missions/${mission.id}/pause`, {});
            if (typeof onSessionClosed === 'function') onSessionClosed(sessionId);
            await render();
          });
          button('Concluir aventura', details, async () => {
            if (!window.confirm('Concluir esta aventura e encerrar a sessão?')) return;
            await request(`/nimrod/missions/${mission.id}/finish`, {
              confirmed: true
            });
            if (typeof onSessionClosed === 'function') onSessionClosed(sessionId);
            await render();
          });
        }
        await request(`/nimrod/sessions/${sessionId}/connection`, {
          eventType: 'heartbeat'
        });
        if(!current())return;
        const rows = await request(`/nimrod/sessions/${sessionId}/attendance`);
        if(!current())return;
        if (rows.some(row => row.user_id === currentIdentity().userId)) button('Confirmar minha presença', details, async () => {
          await request(`/nimrod/sessions/${sessionId}/attendance`, {
            confirmed: true
          });
          await render();
        });
        for (const row of rows) {
          const line = element('p', `${row.name}: ${row.connected ? 'conectado' : 'desconectado'}; ${row.confirmed_at ? 'presença confirmada' : 'presença não confirmada'}`, details);
          if (game.user.isGM && mission.canManage) button(row.confirmed_at ? 'Corrigir: retirar presença' : 'Validar presença', line, async () => {
            const reason = window.prompt('Motivo da correção de presença:');
            if (!reason?.trim()) return;
            await request(`/nimrod/sessions/${sessionId}/attendance`, {
              userId: row.user_id,
              confirmed: !row.confirmed_at,
              reason
            });
            await render();
          });
        }
      }
    }
    select.addEventListener('change', () => show().catch(error => message(error.message)));
    await show();
    button('Atualizar', content, render);
    button('Sair desta associação no PC', content, async () => {
      await game.settings.set(moduleId, 'missionIdentity', {});
      await render();
    });
    const manage=element('a','Gerenciar minhas associações no Nimrod',content);
    manage.href=`${baseUrl().replace(/\/api$/,'')}/foundry-connect`;
    manage.target='_blank';manage.rel='noopener noreferrer';
    manage.style.cssText='display:block;margin-top:10px;color:#edcf8e;';
  }
  async function open() {
    dialog?.remove();
    dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(600px,90vw);max-height:85vh;overflow:auto;background:#21190f;color:#eee1c8;padding:24px;border:1px solid #b28b42;border-radius:10px;z-index:100001;';
    element('h2', 'Nimrod — missões e presença', dialog);
    button('Fechar', dialog, async () => dialog.close());
    const status = element('p', '', dialog);
    status.setAttribute('role', 'status');
    element('div', null, dialog).className = 'nm-content';
    document.body.appendChild(dialog);
    dialog.showModal();
    try {
      await render();
    } catch (error) {
      message(error.message);
    }
  }
  Hooks.once('init', () => game.settings.register(moduleId, 'missionIdentity', {
    scope: 'client',
    config: false,
    type: Object,
    default: {}
  }));
  Hooks.once('ready', () => {
    const launcher = button('Nimrod: missões e presença', document.body, open);
    launcher.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9999;background:#21190f;color:#edcf8e;padding:10px;border:1px solid #b28b42;';
    // Connection heartbeat is separate from confirmation and retries after temporary failures.
    pollTimer = setInterval(async () => {
      if (!currentIdentity().token) return;
      try {
        const missions = await request('/nimrod/missions');
        for (const mission of missions.filter(m => m.active_session_id)) await request(`/nimrod/sessions/${mission.active_session_id}/connection`, {
          eventType: 'heartbeat'
        });
        if (dialog?.open) await render();
      } catch {
        message('Sincronização temporariamente indisponível. Tentaremos novamente automaticamente.');
      }
    }, 30000);
    window.addEventListener('beforeunload', () => {
      clearInterval(pollTimer);
    });
  });
})();
