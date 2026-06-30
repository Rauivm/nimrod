import { query } from '../db/index.js';
import { signFoundryToken, verifyFoundryToken } from '../services/foundryAuth.js';
import { resolveFoundryMapping } from '../services/foundryMap.js';
import { readFoundryActorsDb, syncFoundryActors, upsertFoundryActors } from '../services/foundrySync.js';
import { isGM, isGMPrincipal, isAdmin, requireGM, requireGMPrincipal, requireAdmin } from '../lib/roles.js';
import { broadcast } from "../ws/broadcast.js";

function resolveFoundryLaunchUrl() {
  const publicUrl = process.env.FOUNDRY_PUBLIC_URL?.trim();
  if (publicUrl) return publicUrl.replace(/\/$/, '');

  const configuredUrl = process.env.FOUNDRY_URL?.trim();
  if (!configuredUrl) return null;

  const devUrl = process.env.FOUNDRY_LOCAL_URL?.trim() || process.env.FOUNDRY_DEV_URL?.trim();
  if (process.env.NODE_ENV !== 'production' && configuredUrl.includes('host.docker.internal')) {
    return (devUrl || configuredUrl.replace('host.docker.internal', 'localhost')).replace(/\/$/, '');
  }

  return configuredUrl.replace(/\/$/, '');
}

function buildFoundryLaunchUrl(baseUrl, token) {
  // Foundry serves the game at /game — append it so ?t= is not lost on redirect.
  const base = baseUrl.replace(/\/game$/, ''); // normalize: no trailing /game
  const url = new URL(`${base}/game`);
  url.searchParams.set('t', token);
  return url.toString();
}

/**
 * Foundry VTT integration routes.
 *
 * GET  /foundry/launch            – returns signed-JWT launch URL
 * POST /nimrod/verify             – Foundry module calls to decode JWT
 * GET  /foundry/mapping           – GM: list all mappings
 * PUT  /foundry/mapping           – GM: upsert mapping
 * DELETE /foundry/mapping/:email  – GM: remove mapping
 * GET  /foundry/asset             – proxy Foundry image URLs (no filesystem)
 */

export async function foundryRoutes(fastify) {
  // ── GET /foundry/actors  +  GET /foundry/actors/all-characters ───────────
  // Mesma implementação, duas rotas. /all-characters existe por compatibilidade
  // com o frontend (LinkCharacterModal e outros).
  async function listFoundryActors(req) {
    const result = await readFoundryActorsDb();
    if (result.available) {
      return result.actors.map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        tokenImg: a.tokenImg,
        token: { img: a.tokenImg },
        system: {
          details: {
            level: a.level,
            xp: a.xp,
            biography: a.biography,
          },
        },
      }));
    }

    const cached = await query(
      `SELECT foundry_actor_id AS id, name, portrait_img AS img, token_img,
              level, xp, biography
       FROM player_characters
       WHERE foundry_actor_id IS NOT NULL
       ORDER BY name ASC`,
    );
    return cached.rows.map(a => ({
      id: a.id,
      name: a.name,
      img: a.img,
      tokenImg: a.token_img,
      token: { img: a.token_img },
      system: {
        details: {
          level: a.level,
          xp: a.xp,
          biography: a.biography,
        },
      },
      cached: true,
    }));
  }

  fastify.get('/foundry/actors',                listFoundryActors);
  fastify.get('/foundry/actors/all-characters', listFoundryActors);

  // ── GET /foundry/launch ────────────────────────────────────────────────────
  fastify.get('/foundry/launch', async (req, reply) => {
    const foundryBaseUrl = resolveFoundryLaunchUrl();
    if (!foundryBaseUrl) {
      return reply.code(503).send({ error: 'Foundry URL is not configured on the server.' });
    }
    const secret = process.env.FOUNDRY_JWT_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: 'Foundry JWT secret is not configured.' });
    }

    const { email } = req.user;
    const mapping = await resolveFoundryMapping(undefined, email);
    const activeSessionId = req.query?.sessionId || req.query?.activeSessionId || null;

    let sessionContext = {};
    if (activeSessionId) {
      const sessionRes = await query(
        `SELECT sl.id, sl.status, sl.mission_id, m.creator_id
         FROM session_logs sl
         LEFT JOIN missions m ON m.id = sl.mission_id
         WHERE sl.id = $1 AND sl.deleted_at IS NULL`,
        [activeSessionId],
      );
      if (!sessionRes.rows.length) {
        return reply.code(404).send({ error: 'Session not found.' });
      }

      const session = sessionRes.rows[0];
      if (session.status !== 'open') {
        return reply.code(400).send({ error: 'Session is not open.' });
      }
      if (!session.mission_id) {
        return reply.code(400).send({ error: 'Session is not linked to a mission.' });
      }

      const participantRes = await query(
        `SELECT character_id
         FROM mission_participants
         WHERE mission_id = $1 AND user_id = $2
         LIMIT 1`,
        [session.mission_id, req.user.id],
      );
      const isMissionAuthor = session.creator_id === req.user.id;
      const participant = participantRes.rows[0] ?? null;
      if (!isMissionAuthor && !participant) {
        return reply.code(403).send({ error: 'Only mission participants can enter this session.' });
      }

      sessionContext = {
        activeSessionId,
        sessionId: activeSessionId,
        missionId: session.mission_id,
        userId: req.user.id,
        characterId: participant?.character_id ?? null,
        isMissionAuthor,
      };
    }

    const token   = signFoundryToken({
      e:         email,
      r:         mapping.role,
      w:         mapping.world,
      a:         mapping.actor_name,
      email,
      role:      mapping.role,
      world:     mapping.world,
      actorName: mapping.actor_name,
      actor:     mapping.actor_name,
      ...sessionContext,
    }, secret);

    return { url: buildFoundryLaunchUrl(foundryBaseUrl, token) };
  });

  // ── POST /nimrod/verify ────────────────────────────────────────────────────
  fastify.post('/nimrod/verify', async (req, reply) => {
    const secret = process.env.FOUNDRY_JWT_SECRET;
    if (!secret) return reply.code(503).send({ error: 'Foundry JWT secret is not configured.' });

    const token = req.body?.token;
    if (!token) return reply.code(400).send({ error: 'token is required' });

    try {
      const payload = verifyFoundryToken(token, secret);
      return reply.send(payload);
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  });

  // ── GET /foundry/mapping ───────────────────────────────────────────────────
  async function registerSessionPresence(req, reply, leaving = false) {
    const secret = process.env.FOUNDRY_JWT_SECRET;
    if (!secret) return reply.code(503).send({ error: 'Foundry JWT secret is not configured.' });

    const token = req.body?.token;
    if (!token) return reply.code(400).send({ error: 'token is required' });

    let payload;
    try {
      payload = verifyFoundryToken(token, secret);
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const sessionId = payload.sessionId || payload.activeSessionId;
    const missionId = payload.missionId ?? null;
    const userId = payload.userId ?? null;
    const characterId = req.body?.characterId || payload.characterId || null;
    const actorName = req.body?.actorName || payload.actor || payload.actorName || payload.a || null;

    if (!sessionId || !missionId || !userId) {
      return reply.code(400).send({ error: 'token does not contain session context' });
    }

    const session = await query(
      `SELECT id, status FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [sessionId],
    );
    if (!session.rows.length) return reply.code(404).send({ error: 'Session not found.' });

    if (!leaving && session.rows[0].status !== 'open') {
      return reply.code(400).send({ error: 'Session is not open.' });
    }

    if (leaving) {
      const res = await query(
        `UPDATE session_attendance
         SET left_at = COALESCE(left_at, NOW()),
             actor_name = COALESCE($4, actor_name)
         WHERE session_id = $1
           AND mission_id = $2
           AND user_id = $3
           AND left_at IS NULL
         RETURNING *`,
        [sessionId, missionId, userId, actorName],
      );
      return { ok: true, attendance: res.rows[0] ?? null };
    }

    const res = await query(
      `INSERT INTO session_attendance
         (session_id, mission_id, user_id, character_id, actor_name, entered_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (session_id, user_id) DO UPDATE SET
         character_id = COALESCE(EXCLUDED.character_id, session_attendance.character_id),
         actor_name = COALESCE(EXCLUDED.actor_name, session_attendance.actor_name),
         last_seen_at = NOW(),
         left_at = NULL
       RETURNING *`,
      [sessionId, missionId, userId, characterId, actorName],
    );
    return { ok: true, attendance: res.rows[0] };
  }

  fastify.post('/nimrod/session/enter', async (req, reply) => registerSessionPresence(req, reply, false));
  fastify.post('/nimrod/session/leave', async (req, reply) => registerSessionPresence(req, reply, true));

  // ── POST /nimrod/handshake ─────────────────────────────────────────────────
  // Chamado pelo módulo Foundry ao inicializar.
  // Gera um código curto, armazena o estado do mundo e retorna o código.
  // Autenticado via X-Nimrod-Key. Não requer auth Cloudflare/Nimrod.
  //
  // Body: { worldId, gmName?, players?, tokens? }
  // Retorna: { code, expiresAt }
  fastify.post('/nimrod/handshake', async (req, reply) => {
    const sentKey       = req.headers['x-nimrod-key'];
    const configuredKey = process.env.FOUNDRY_API_KEY?.trim();
    if (!configuredKey) return reply.code(503).send({ error: 'Not configured.' });
    const { timingSafeEqual } = await import('node:crypto');
    const valid = sentKey?.length === configuredKey.length &&
      timingSafeEqual(Buffer.from(sentKey), Buffer.from(configuredKey));
    if (!valid) return reply.code(401).send({ error: 'Invalid API key.' });

    const { worldId, gmName = null, players = [], tokens = [] } = req.body ?? {};
    if (!worldId?.trim()) return reply.code(400).send({ error: 'worldId é obrigatório.' });

    // Limpa handshakes expirados do mesmo mundo (housekeeping inline)
    await query(
      `DELETE FROM foundry_handshakes
       WHERE world_id = $1 AND expires_at <= NOW() AND claimed_at IS NULL`,
      [worldId.trim()],
    );

    // Gera código único de 7 caracteres (sem 0/O/1/I para legibilidade)
    const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ234679';
    let code;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = Array.from({ length: 7 }, () =>
        ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
      ).join('');
      const dup = await query(
        `SELECT 1 FROM foundry_handshakes WHERE code = $1 AND expires_at > NOW()`,
        [candidate],
      );
      if (!dup.rows.length) { code = candidate; break; }
    }
    if (!code) return reply.code(500).send({ error: 'Não foi possível gerar código único.' });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await query(
      `INSERT INTO foundry_handshakes (code, world_id, gm_name, players, tokens, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET
         world_id   = EXCLUDED.world_id,
         gm_name    = EXCLUDED.gm_name,
         players    = EXCLUDED.players,
         tokens     = EXCLUDED.tokens,
         expires_at = EXCLUDED.expires_at,
         claimed_at = NULL,
         session_id = NULL,
         claimed_by = NULL`,
      [code, worldId.trim(), gmName ?? null,
       JSON.stringify(players), JSON.stringify(tokens), expiresAt.toISOString()],
    );

    req.log.info({ code, worldId }, 'foundry handshake created');
    return reply.code(201).send({ code, expiresAt: expiresAt.toISOString() });
  });

  // ── GET /nimrod/handshake/status ───────────────────────────────────────────
  // Polling do módulo Foundry — verifica se o GM já vinculou a sessão.
  // Autenticado via X-Nimrod-Key. Não requer auth Cloudflare/Nimrod.
  //
  // Query: ?code=XXXXXXX
  // Retorna:
  //   { linked: false }                              → aguardando GM digitar o código
  //   { linked: true, sessionId, missionId }         → sessão vinculada
  //   404                                            → código não encontrado ou expirado
  fastify.get('/nimrod/handshake/status', async (req, reply) => {
    const sentKey       = req.headers['x-nimrod-key'];
    const configuredKey = process.env.FOUNDRY_API_KEY?.trim();
    if (!configuredKey) return reply.code(503).send({ error: 'Not configured.' });
    const { timingSafeEqual } = await import('node:crypto');
    const valid = sentKey?.length === configuredKey.length &&
      timingSafeEqual(Buffer.from(sentKey), Buffer.from(configuredKey));
    if (!valid) return reply.code(401).send({ error: 'Invalid API key.' });

    const { code } = req.query;
    if (!code?.trim()) return reply.code(400).send({ error: 'code é obrigatório.' });

    const res = await query(
      `SELECT fh.code, fh.claimed_at, fh.session_id, fh.expires_at,
              sl.mission_id, sl.status AS session_status
       FROM foundry_handshakes fh
       LEFT JOIN session_logs sl ON sl.id = fh.session_id
       WHERE fh.code = $1`,
      [code.trim().toUpperCase()],
    );

    if (!res.rows.length) return reply.code(404).send({ error: 'Código não encontrado.' });

    const hs = res.rows[0];

    if (!hs.claimed_at && new Date(hs.expires_at) < new Date()) {
      return reply.code(404).send({ error: 'Código expirado.' });
    }

    if (!hs.claimed_at || !hs.session_id) {
      return { linked: false };
    }

    return {
      linked:        true,
      sessionId:     hs.session_id,
      missionId:     hs.mission_id    ?? null,
      sessionStatus: hs.session_status ?? null,
    };
  });

  // ── POST /nimrod/session/presence ──────────────────────────────────────────
  // Registra eventos de presença do módulo Foundry em session_attendance.
  // Autenticado via X-Nimrod-Key. Não requer auth Nimrod/CF.
  //
  // Body: { sessionId, eventType, foundryUserId, foundryName, characterName?,
  //         actorId?, hp?, occurredAt? }
  // eventType: 'enter' | 'leave' | 'reconnect'
  //
  // Resolução de identidade (em ordem):
  //   1. user_foundry_map.actor_name = characterName  → resolve email → users.id
  //   2. user_foundry_map.actor_name = foundryName    → idem
  //   3. player_characters.foundry_actor_id = actorId → resolve user_id diretamente
  //   4. foundryName match em users.name / display_name (fallback)
  // Se nenhuma resolução funcionar, registra apenas o WS event (sem DB insert).
  fastify.post('/nimrod/session/presence', async (req, reply) => {
    const sentKey       = req.headers['x-nimrod-key'];
    const configuredKey = process.env.FOUNDRY_API_KEY?.trim();
    if (!configuredKey) return reply.code(503).send({ error: 'Not configured.' });
    const { timingSafeEqual } = await import('node:crypto');
    const valid = sentKey?.length === configuredKey.length &&
      timingSafeEqual(Buffer.from(sentKey), Buffer.from(configuredKey));
    if (!valid) return reply.code(401).send({ error: 'Invalid API key.' });

    const {
      sessionId,
      eventType,
      foundryUserId,
      foundryName,
      characterName = null,
      actorId       = null,
      hp            = null,
      occurredAt    = null,
    } = req.body ?? {};

    if (!sessionId || !eventType || !foundryUserId) {
      return reply.code(400).send({ error: 'sessionId, eventType e foundryUserId são obrigatórios.' });
    }

    // Valida sessão
    const slRes = await query(
      `SELECT id, status, mission_id FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [sessionId],
    );
    if (!slRes.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    if (slRes.rows[0].status !== 'open') return reply.code(400).send({ error: 'Sessão não está aberta.' });

    const { mission_id: missionId } = slRes.rows[0];
    const ts = occurredAt ? new Date(occurredAt) : new Date();

    // ── Resolução de user_id ────────────────────────────────────────────────
    let userId      = null;
    let characterId = null;

    // 1. Tenta via player_characters.foundry_actor_id (mais preciso)
    if (actorId) {
      const pcRes = await query(
        `SELECT pc.id AS character_id, pc.user_id
         FROM player_characters pc
         WHERE pc.foundry_actor_id = $1
           AND pc.active = TRUE AND pc.retired = FALSE
         LIMIT 1`,
        [actorId],
      );
      if (pcRes.rows.length) {
        userId      = pcRes.rows[0].user_id;
        characterId = pcRes.rows[0].character_id;
      }
    }

    // 2. Tenta via player_characters.name = characterName
    if (!userId && characterName) {
      const pcRes = await query(
        `SELECT pc.id AS character_id, pc.user_id
         FROM player_characters pc
         WHERE LOWER(pc.name) = LOWER($1)
           AND pc.active = TRUE AND pc.retired = FALSE
         LIMIT 1`,
        [characterName],
      );
      if (pcRes.rows.length) {
        userId      = pcRes.rows[0].user_id;
        characterId = pcRes.rows[0].character_id;
      }
    }

    // 3. Tenta via user_foundry_map.actor_name = characterName ou foundryName
    if (!userId) {
      const lookupName = characterName ?? foundryName;
      const fmRes = await query(
        `SELECT u.id AS user_id
         FROM user_foundry_map fm
         JOIN users u ON u.email = fm.email
         WHERE LOWER(fm.actor_name) = LOWER($1)
         LIMIT 1`,
        [lookupName],
      );
      if (fmRes.rows.length) userId = fmRes.rows[0].user_id;
    }

    // 4. Fallback: users.name ou display_name = foundryName
    if (!userId && foundryName) {
      const uRes = await query(
        `SELECT id FROM users
         WHERE LOWER(COALESCE(display_name, name)) = LOWER($1)
         LIMIT 1`,
        [foundryName],
      );
      if (uRes.rows.length) userId = uRes.rows[0].id;
    }

    // Se não conseguiu resolver, apenas emite WS sem gravar no banco
    if (!userId) {
      req.log.warn(
        { foundryUserId, foundryName, characterName, actorId },
        'presence: não foi possível resolver user_id — evento WS emitido sem persistência',
      );
      broadcast('SESSION_PRESENCE', {
        sessionId, eventType, foundryName, characterName,
        occurredAt: ts.toISOString(), persisted: false,
      });
      return { ok: true, persisted: false, reason: 'user_id não resolvido' };
    }

    // ── Grava em session_attendance ─────────────────────────────────────────
    if (eventType === 'enter' || eventType === 'reconnect') {
      await query(
        `INSERT INTO session_attendance
           (session_id, mission_id, user_id, character_id, actor_name, entered_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (session_id, user_id) DO UPDATE SET
           character_id  = COALESCE(EXCLUDED.character_id, session_attendance.character_id),
           actor_name    = COALESCE(EXCLUDED.actor_name,   session_attendance.actor_name),
           last_seen_at  = EXCLUDED.last_seen_at,
           left_at       = NULL     -- reconectou: limpa saída anterior`,
        [sessionId, missionId, userId, characterId, characterName ?? foundryName, ts],
      );
    } else if (eventType === 'leave') {
      await query(
        `UPDATE session_attendance
         SET left_at = $1, last_seen_at = $1
         WHERE session_id = $2 AND user_id = $3 AND left_at IS NULL`,
        [ts, sessionId, userId],
      );
    }

    broadcast('SESSION_PRESENCE', {
      sessionId, eventType, foundryName, characterName,
      occurredAt: ts.toISOString(), persisted: true, userId,
    });

    return { ok: true, persisted: true, userId, characterId };
  });

  // ── GET /nimrod/session/status ─────────────────────────────────────────────
  // Consulta o status de uma sessão — usado pelo nimrod-bridge para detectar
  // quando a sessão foi encerrada no Nimrod.
  // Autenticado via X-Nimrod-Key. Não requer auth Nimrod/CF.
  //
  // Query: ?sessionId=<uuid>
  fastify.get('/nimrod/session/status', async (req, reply) => {
    const sentKey       = req.headers['x-nimrod-key'];
    const configuredKey = process.env.FOUNDRY_API_KEY?.trim();
    if (!configuredKey) return reply.code(503).send({ error: 'Not configured.' });
    const { timingSafeEqual } = await import('node:crypto');
    const valid = sentKey?.length === configuredKey.length &&
      timingSafeEqual(Buffer.from(sentKey), Buffer.from(configuredKey));
    if (!valid) return reply.code(401).send({ error: 'Invalid API key.' });

    const { sessionId } = req.query;
    if (!sessionId) return reply.code(400).send({ error: 'sessionId é obrigatório.' });

    const res = await query(
      `SELECT id, status, closed_at FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [sessionId],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    const sl = res.rows[0];
    return { sessionId: sl.id, status: sl.status, closedAt: sl.closed_at ?? null };
  });

  fastify.get('/foundry/mapping', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });
    const result = await query(
      `SELECT email, role, world, actor_name AS "actorName" FROM user_foundry_map ORDER BY email`,
    );
    return result.rows;
  });

  // ── PUT /foundry/mapping ───────────────────────────────────────────────────
  fastify.put('/foundry/mapping', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const { email, role, world, actorName } = req.body ?? {};
    if (!email || !role || !world) {
      return reply.code(400).send({ error: 'email, role and world are required' });
    }

    const result = await query(
      `INSERT INTO user_foundry_map (email, role, world, actor_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         role = EXCLUDED.role, world = EXCLUDED.world, actor_name = EXCLUDED.actor_name
       RETURNING email, role, world, actor_name AS "actorName"`,
      [email, role, world, actorName ?? null],
    );
    return result.rows[0];
  });

  // ── DELETE /foundry/mapping/:email ─────────────────────────────────────────
  fastify.delete('/foundry/mapping/:email', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const result = await query(
      'DELETE FROM user_foundry_map WHERE email = $1 RETURNING email',
      [req.params.email],
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Mapping not found' });
    return { deleted: req.params.email };
  });

  // ── GET /foundry/asset ─────────────────────────────────────────────────────
  // Proxies Foundry-hosted image URLs to avoid CORS issues in the browser.
  // The `path` param is a URL path as served by Foundry (e.g. /worlds/my-world/tokens/hero.png).
  // The asset is fetched from FOUNDRY_URL and streamed to the client.
  // NO filesystem access — works while Foundry is open.
  async function proxyFoundryAsset(req, reply) {
    const { path: assetPath } = req.query;
    if (!assetPath) return reply.code(400).send({ error: 'path is required' });

    const foundryBase = (process.env.FOUNDRY_PUBLIC_URL || process.env.FOUNDRY_URL)?.replace(/\/$/, '');
    if (!foundryBase) return reply.code(503).send({ error: 'FOUNDRY_URL not configured' });

    // Only allow relative paths (no external URLs via this proxy)
    if (/^https?:\/\//i.test(assetPath)) {
      return reply.code(400).send({ error: 'Absolute URLs not allowed' });
    }

    // Prevent path traversal
    const safe = assetPath.replace(/\.\./g, '').replace(/^\/+/, '/');
    const url  = `${foundryBase}${safe.startsWith('/') ? safe : `/${safe}`}`;

    const timeout    = parseInt(process.env.FOUNDRY_SYNC_TIMEOUT_MS) || 10_000;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    try {
      const upstream = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!upstream.ok) return reply.code(upstream.status).send({ error: 'Asset not found in Foundry' });

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=3600');

      // Stream response body
      return reply.send(upstream.body);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return reply.code(504).send({ error: 'Foundry asset request timed out' });
      return reply.code(502).send({ error: 'Could not reach Foundry' });
    }
  }

  fastify.get('/foundry/asset', proxyFoundryAsset);
  fastify.get('/foundry/assets', proxyFoundryAsset);
  // ── POST /foundry/push-actors ──────────────────────────────────────────────
  fastify.options('/foundry/push-actors', async (req, reply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Headers', 'Content-Type, X-Nimrod-Key')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .send();
  });

  fastify.post('/foundry/push-actors', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');

    const sentKey       = req.headers['x-nimrod-key'];
    const configuredKey = process.env.FOUNDRY_API_KEY?.trim();

    if (!configuredKey) {
      req.log.error('FOUNDRY_API_KEY is not set');
      return reply.code(503).send({ error: 'Service not configured' });
    }

    // Comparação em tempo constante — previne timing attacks
    const { timingSafeEqual } = await import('node:crypto');
    const valid =
      sentKey?.length === configuredKey.length &&
      timingSafeEqual(Buffer.from(sentKey), Buffer.from(configuredKey));

    if (!valid) {
      req.log.warn({ ip: req.ip }, 'push-actors: invalid API key');
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    const actors = Array.isArray(req.body?.actors) ? req.body.actors : [];

    if (!actors.length) {
      return reply.code(400).send({ error: 'actors array is required and must be non-empty' });
    }

    const result = await upsertFoundryActors(actors);

    req.log.info({ ...result }, 'push-actors complete');
    return { ok: true, ...result };
  });

  fastify.post('/foundry/actors/sync', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });
    return syncFoundryActors();
  });
}