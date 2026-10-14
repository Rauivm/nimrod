/**
 * services/tavernRoom.js
 *
 * Sala autoritativa da Taverna. Roda por cima da infraestrutura de
 * WebSocket que já existe (a rota `/ws` em index.js): não abre socket
 * novo, não reimplementa autenticação — só passa a escutar mensagens na
 * mesma conexão que já existe hoje (que antes só empurrava eventos pro
 * cliente via `registerClient`/`broadcast`, nunca recebia nada de volta).
 *
 * IMPORTANTE: o protocolo aqui é EXATAMENTE o que
 * experiments/tavern/src/engine/types.ts já define — mensagens PLANAS
 * (`{ type, ...campos }`), sem envelope `{type,data,ts}` e sem prefixo
 * `TAVERN_`. Por isso este módulo manda direto pro socket
 * (`socket.send(JSON.stringify(msg))`) em vez de reusar o `broadcast()`
 * de `ws/broadcast.js`, que embrulha tudo em `{type,data,ts}` — formato
 * que o cliente da Taverna não é o que já está rodando no navegador.
 *
 * Fonte única de verdade para personagens: toda leitura aqui é
 * `player_characters` via `query()`, a mesma tabela que /me/characters
 * e /players já usam. Nenhuma posição é persistida — é estado de lobby
 * efêmero, não faz sentido sobreviver a um restart.
 *
 * Fluxo:
 *   1. Cliente conecta em /ws (autenticado por cfAuthMiddleware, como
 *      qualquer outra conexão) e manda { type: "JOIN", characterId }.
 *   2. Servidor confere que o personagem pertence ao usuário autenticado,
 *      registra a conexão, manda o estado atual só pra esse socket
 *      (PLAYER_JOINED de cada jogador já presente), depois transmite
 *      PLAYER_JOINED do recém-chegado pra todo mundo (incluindo ele
 *      mesmo — é a confirmação da posição de spawn autoritativa).
 *   3. MOVE_REQUEST / DIRECTION_REQUEST só setam intenção; o tick loop
 *      decide quanto de fato anda, validando colisão e limites do mapa a
 *      cada passo, e transmite PLAYER_MOVED / PLAYER_STOPPED.
 *   4. POSITION_SYNC periódico corrige qualquer cliente que tenha perdido
 *      um pacote.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../db/index.js';
import { loadCollisionMap, resolveMovement } from './tavernCollision.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Projeção mundo <-> pixel da imagem de fundo ────────────────────────────
// TEM que ficar igual ao FLOOR_QUAD de experiments/tavern/src/engine/
// TavernScene.ts — se o mapa mudar, atualize os dois lados (ou promova
// isso a um JSON de config compartilhado quando a Taverna sair do
// experimento).
const FLOOR_QUAD = {
  topLeft: { x: 0.23, y: 0.21 },
  topRight: { x: 0.9, y: 0.21 },
  bottomRight: { x: 0.9, y: 0.87 },
  bottomLeft: { x: 0.23, y: 0.87 },
};

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function worldToImagePx(pos, imageWidth, imageHeight) {
  const { topLeft, topRight, bottomLeft, bottomRight } = FLOOR_QUAD;
  const top = lerpPoint(topLeft, topRight, pos.x);
  const bottom = lerpPoint(bottomLeft, bottomRight, pos.x);
  const point = lerpPoint(top, bottom, pos.y);
  return { x: point.x * imageWidth, y: point.y * imageHeight };
}

function imagePxToWorld(px, imageWidth, imageHeight) {
  const { topLeft, topRight, bottomLeft } = FLOOR_QUAD;
  const fx = px.x / imageWidth;
  const fy = px.y / imageHeight;
  const ux = topRight.x - topLeft.x;
  const uy = topRight.y - topLeft.y;
  const vx = bottomLeft.x - topLeft.x;
  const vy = bottomLeft.y - topLeft.y;
  const dx = fx - topLeft.x;
  const dy = fy - topLeft.y;
  const det = ux * vy - uy * vx || 1e-6;
  return {
    x: clamp01((dx * vy - dy * vx) / det),
    y: clamp01((ux * dy - uy * dx) / det),
  };
}

/** Mesma resolução de URL que o cliente já faz em nimrodApi.ts — tem que bater igual. */
function foundryAssetUrl(path) {
  if (!path) return '';
  return `/api/foundry/assets?path=${encodeURIComponent(path)}`;
}

// ── Config ──────────────────────────────────────────────────────────────────
// Precisa bater com LOCAL_PREDICTED_SPEED / PLAYER_COLLISION_RADIUS_PX em
// TavernScene.ts.
const MAX_SPEED_WORLD_PER_SEC = 0.18;
const PLAYER_COLLISION_RADIUS_PX = 20;
const TICK_HZ = 20;
const TICK_INTERVAL_MS = 1000 / TICK_HZ;
const POSITION_SYNC_INTERVAL_MS = 3000;
const ARRIVE_EPSILON = 0.004;
const DEFAULT_SPAWN = { x: 0.5, y: 0.78 }; // perto da entrada

const rawCollisionMap = JSON.parse(
  readFileSync(join(__dirname, 'tavernCollision.json'), 'utf8'),
);
const collisionMap = loadCollisionMap(rawCollisionMap);
const { imageWidth: IMG_W, imageHeight: IMG_H } = rawCollisionMap;

/** @type {Map<string, object>} characterId -> estado do jogador na sala */
const players = new Map();
/** @type {Map<object, string>} socket -> characterId (pra saber quem saiu no close) */
const characterIdBySocket = new Map();

let tickTimer = null;
let syncTimer = null;

function send(socket, msg) {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // socket fechado/inválido — o handler de close cuida da limpeza
  }
}

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const p of players.values()) {
    try {
      p.socket.send(payload);
    } catch {
      // idem — ignora, o close cuida
    }
  }
}

function toWirePlayer(p) {
  return {
    id: p.characterId,
    name: p.name,
    level: p.level,
    tokenImageUrl: foundryAssetUrl(p.tokenImg),
    portraitImageUrl: foundryAssetUrl(p.portraitImg || p.tokenImg),
    position: p.position,
  };
}

function startLoopIfNeeded() {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  syncTimer = setInterval(broadcastPositionSync, POSITION_SYNC_INTERVAL_MS);
}

function stopLoopIfEmpty() {
  if (players.size > 0) return;
  if (tickTimer) clearInterval(tickTimer);
  if (syncTimer) clearInterval(syncTimer);
  tickTimer = null;
  syncTimer = null;
}

/** Mesma regra usada em routes/missions.js pra entrar numa missão com um personagem específico. */
async function loadOwnedCharacter(characterId, userId) {
  const res = await query(
    `SELECT id, name, level, token_img, portrait_img
     FROM player_characters
     WHERE id = $1 AND user_id = $2 AND active = TRUE AND retired = FALSE
       AND COALESCE(dead, FALSE) = FALSE`,
    [characterId, userId],
  );
  return res.rows[0] ?? null;
}

/**
 * Entrada point chamado pelo handler de `/ws` em index.js para cada
 * mensagem recebida nessa conexão.
 *
 * @param {object} user - req.user (linha crua de `users`, injetada pelo cfAuthMiddleware)
 * @param {{ send(data: string): void }} socket
 * @param {string} raw - payload bruto recebido do socket
 */
export async function handleTavernMessage(user, socket, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return; // payload invalido — ignora silenciosamente, igual ao resto do /ws hoje
  }
  if (typeof msg?.type !== 'string') return;

  switch (msg.type) {
    case 'JOIN':
      await handleJoin(user, socket, msg.characterId);
      break;
    case 'MOVE_REQUEST':
      handleMoveRequest(socket, msg.target);
      break;
    case 'DIRECTION_REQUEST':
      handleDirectionRequest(socket, msg.direction);
      break;
    case 'CHAT_SEND':
      handleChatSend(socket, msg.channel, msg.text);
      break;
    default:
      break; // outros tipos (globais do app) nao sao desta sala — ignora
  }
}

/** Chamado pelo handler de `close` do socket em index.js. */
export function handleTavernSocketClose(socket) {
  const characterId = characterIdBySocket.get(socket);
  if (!characterId) return;
  characterIdBySocket.delete(socket);
  if (!players.delete(characterId)) return;
  broadcast({ type: 'PLAYER_LEFT', playerId: characterId });
  stopLoopIfEmpty();
}

async function handleJoin(user, socket, characterId) {
  if (!characterId) return;

  const char = await loadOwnedCharacter(characterId, user.id);
  if (!char) {
    send(socket, {
      type: 'ERROR',
      code: 'CHARACTER_NOT_FOUND',
      message: 'Personagem invalido ou nao pertence a voce.',
    });
    return;
  }

  // Se o mesmo personagem já estava numa outra aba/conexão, tira o antigo primeiro.
  const existing = players.get(char.id);
  if (existing) {
    characterIdBySocket.delete(existing.socket);
    players.delete(char.id);
    broadcast({ type: 'PLAYER_LEFT', playerId: char.id });
  }

  // Estado atual pro recem-chegado, antes de adiciona-lo.
  for (const p of players.values()) {
    send(socket, { type: 'PLAYER_JOINED', player: toWirePlayer(p) });
  }

  const entry = {
    characterId: char.id,
    userId: user.id,
    socket,
    name: char.name,
    level: char.level,
    tokenImg: char.token_img,
    portraitImg: char.portrait_img,
    position: { ...DEFAULT_SPAWN },
    moveTarget: null,
    moveDirection: { x: 0, y: 0 },
  };
  players.set(char.id, entry);
  characterIdBySocket.set(socket, char.id);

  // Confirma pro proprio jogador (com a posicao de spawn autoritativa) + avisa os outros.
  broadcast({ type: 'PLAYER_JOINED', player: toWirePlayer(entry) });

  startLoopIfNeeded();
}

function handleMoveRequest(socket, target) {
  const characterId = characterIdBySocket.get(socket);
  const p = characterId ? players.get(characterId) : null;
  if (!p || !target) return;
  p.moveTarget = {
    x: Math.min(1, Math.max(0, Number(target.x))),
    y: Math.min(1, Math.max(0, Number(target.y))),
  };
  p.moveDirection = { x: 0, y: 0 };
}

function handleDirectionRequest(socket, direction) {
  const characterId = characterIdBySocket.get(socket);
  const p = characterId ? players.get(characterId) : null;
  if (!p || !direction) return;
  // so aceita vetores logicos (-1/0/1) — nao confia em magnitude vinda do cliente
  p.moveDirection = {
    x: Math.sign(Number(direction.x) || 0),
    y: Math.sign(Number(direction.y) || 0),
  };
  p.moveTarget = null;
}

function handleChatSend(socket, channel, text) {
  const characterId = characterIdBySocket.get(socket);
  const p = characterId ? players.get(characterId) : null;
  if (!p) return;
  const cleanText = String(text ?? '').trim().slice(0, 280);
  if (!cleanText) return;
  const cleanChannel = ['global', 'taverna', 'grupo'].includes(channel) ? channel : 'global';

  broadcast({
    type: 'CHAT_MESSAGE',
    message: {
      id: `${p.characterId}-${Date.now()}`,
      authorId: p.characterId,
      authorName: p.name, // nome do personagem, nunca vindo do payload do cliente
      channel: cleanChannel,
      text: cleanText,
      timestamp: Date.now(),
    },
  });
}

function tick() {
  for (const p of players.values()) stepPlayer(p);
}

/** O coracao da autoridade do servidor: decide se/quanto cada jogador anda, validando colisao a cada passo. */
function stepPlayer(p) {
  const dt = TICK_INTERVAL_MS / 1000;
  const dir = p.moveDirection;
  const hasDirection = dir.x !== 0 || dir.y !== 0;

  let proposed = null;
  if (hasDirection) {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const step = MAX_SPEED_WORLD_PER_SEC * dt;
    proposed = { x: p.position.x + (dir.x / len) * step, y: p.position.y + (dir.y / len) * step };
  } else if (p.moveTarget) {
    const target = p.moveTarget;
    const dx = target.x - p.position.x;
    const dy = target.y - p.position.y;
    const dist = Math.hypot(dx, dy);
    const step = MAX_SPEED_WORLD_PER_SEC * dt;
    proposed = dist <= step || dist < 0.001
      ? { ...target }
      : { x: p.position.x + (dx / dist) * step, y: p.position.y + (dy / dist) * step };
  }

  if (!proposed) return;

  const fromPx = worldToImagePx(p.position, IMG_W, IMG_H);
  const proposedPx = worldToImagePx(proposed, IMG_W, IMG_H);
  const resolvedPx = resolveMovement(collisionMap, fromPx, proposedPx, PLAYER_COLLISION_RADIUS_PX);

  if (resolvedPx === fromPx) {
    if (p.moveTarget || hasDirection) {
      p.moveTarget = null;
      p.moveDirection = { x: 0, y: 0 };
      broadcast({ type: 'PLAYER_STOPPED', playerId: p.characterId, position: p.position });
    }
    return;
  }

  // "Zeno": alvo atras/dentro de um obstaculo + abordagem quase alinhada com
  // o eixo bloqueado faz o slideX/slideY renderem progresso real porem cada
  // vez menor, sem nunca satisfazer nem "chegou" nem "bloqueio total". Sem
  // isso o servidor ficaria transmitindo PLAYER_MOVED pra sempre com deltas
  // cada vez menores. Se o passo resolvido andou menos de meio pixel, trata
  // como parado.
  const movedPx = Math.hypot(resolvedPx.x - fromPx.x, resolvedPx.y - fromPx.y);
  const stalled = movedPx < 0.5;

  p.position = imagePxToWorld(resolvedPx, IMG_W, IMG_H);

  const reachedTarget = p.moveTarget !== null
    && resolvedPx === proposedPx
    && Math.hypot(p.position.x - p.moveTarget.x, p.position.y - p.moveTarget.y) < ARRIVE_EPSILON;

  if (reachedTarget || stalled) {
    p.moveTarget = null;
    p.moveDirection = { x: 0, y: 0 };
    broadcast({ type: 'PLAYER_STOPPED', playerId: p.characterId, position: p.position });
  } else {
    broadcast({
      type: 'PLAYER_MOVED',
      playerId: p.characterId,
      position: p.position,
      target: p.moveTarget,
    });
  }
}

function broadcastPositionSync() {
  if (players.size === 0) return;
  broadcast({
    type: 'POSITION_SYNC',
    players: Array.from(players.values()).map((p) => ({ playerId: p.characterId, position: p.position })),
    serverTime: Date.now(),
  });
}