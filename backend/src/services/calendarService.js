/**
 * src/services/calendarService.js
 *
 * Fonte única de verdade para toda a lógica do Calendário do Mundo.
 *
 * Conceito: o mundo avança por Sessões. Tudo mais (ano, estação, semana da
 * estação, sessão dentro do ano, sessões restantes para a próxima estação)
 * é DERIVADO da sessão corrente — nunca armazenado. Isso garante que esses
 * valores nunca fiquem dessincronizados entre si.
 *
 * Regras (Ano 137 DC):
 *   • O Ano 137 começa na Sessão 1.
 *   • Cada ano tem 48 sessões.
 *   • Cada estação tem exatamente 12 sessões.
 *   • Ordem das estações dentro do ano: Inverno → Primavera → Verão → Outono.
 *     (O ano sempre começa no primeiro dia de Inverno e termina no
 *     último dia de Outono.)
 *
 * A ordem das estações é mantida em um único array (SEASON_ORDER) para que,
 * caso precise mudar no futuro, baste alterar esse array — nenhum outro
 * lugar do projeto deve reimplementar essa regra.
 *
 * Nenhuma rota deve calcular ano/estação/semana manualmente — sempre passar
 * pelo CalendarService.
 */

import { pool, query } from '../db/index.js';

// ─── Constantes do calendário (única fonte de verdade) ─────────────────────

export const START_YEAR           = 137;   // Ano em que a Sessão 1 acontece
export const SESSIONS_PER_YEAR    = 48;
export const SESSIONS_PER_SEASON  = 12;

// Ordem das estações dentro de um ano, começando pela Sessão 1 do ano.
// Mudar a ordem sazonal do mundo = mudar só este array.
export const SEASON_ORDER = ['Inverno', 'Primavera', 'Verão', 'Outono'];

const SEASONS_PER_YEAR = SEASON_ORDER.length; // 4

// ─── Cálculo puro (sem I/O) ─────────────────────────────────────────────────

/**
 * Deriva todo o estado do calendário a partir do número da sessão corrente.
 *
 * @param {number} currentSession — inteiro >= 1
 * @returns {{
 *   currentSession: number,
 *   year: number,
 *   season: string,
 *   seasonIndex: number,
 *   weekOfSeason: number,
 *   sessionInYear: number,
 *   sessionsUntilNextSeason: number,
 *   nextSeason: string,
 * }}
 */
export function computeCalendarState(currentSession) {
  if (!Number.isInteger(currentSession) || currentSession < 1) {
    throw new CalendarError('current_session deve ser um inteiro >= 1');
  }

  // 0-indexado a partir da Sessão 1 do Ano 137.
  const offset = currentSession - 1;

  const yearIndex = Math.floor(offset / SESSIONS_PER_YEAR);
  const year       = START_YEAR + yearIndex;

  // Sessão dentro do ano corrente (1..SESSIONS_PER_YEAR).
  const sessionInYear = (offset % SESSIONS_PER_YEAR) + 1;

  const seasonIndex = Math.floor((sessionInYear - 1) / SESSIONS_PER_SEASON);
  const season       = SEASON_ORDER[seasonIndex];

  // Semana dentro da estação (1..SESSIONS_PER_SEASON).
  const weekOfSeason = ((sessionInYear - 1) % SESSIONS_PER_SEASON) + 1;

  const sessionsUntilNextSeason = SESSIONS_PER_SEASON - weekOfSeason;
  const nextSeason = SEASON_ORDER[(seasonIndex + 1) % SEASONS_PER_YEAR];

  return {
    currentSession,
    year,
    season,
    seasonIndex,
    weekOfSeason,
    sessionInYear,
    sessionsUntilNextSeason,
    nextSeason,
  };
}

// ─── Erros ──────────────────────────────────────────────────────────────────

export class CalendarError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CalendarError';
    this.statusCode = statusCode;
  }
}

// ─── Persistência ───────────────────────────────────────────────────────────

/**
 * Garante que a linha singleton exista (defensivo — a migration já semeia
 * a linha, mas isso protege contra bancos criados fora do fluxo normal).
 */
async function ensureRow(client) {
  const res = await client.query('SELECT * FROM world_calendar WHERE id = 1');
  if (res.rowCount > 0) return res.rows[0];

  const inserted = await client.query(
    `INSERT INTO world_calendar (id, current_session)
     VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
     RETURNING *`,
  );
  return inserted.rows[0];
}

/**
 * Retorna o estado atual completo do calendário (para GET /world/calendar).
 */
export async function getCalendarState() {
  const row = await ensureRow(pool);
  return {
    ...computeCalendarState(row.current_session),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/**
 * Aplica uma mudança na sessão corrente dentro de uma transação, gravando
 * a auditoria (sessão anterior, sessão nova, quem, quando, ação).
 *
 * @param {(prevSession: number) => number} computeNewSession — recebe a
 *   sessão atual e retorna a nova sessão desejada.
 * @param {'next'|'previous'|'set'} action
 * @param {string} userId — uuid do usuário que fez a alteração
 */
async function applyChange(computeNewSession, action, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock da linha para evitar duas alterações concorrentes colidirem.
    const current = await client.query(
      'SELECT * FROM world_calendar WHERE id = 1 FOR UPDATE',
    );
    const row = current.rowCount > 0 ? current.rows[0] : await ensureRow(client);

    const previousSession = row.current_session;
    const newSession       = computeNewSession(previousSession);

    if (!Number.isInteger(newSession) || newSession < 1) {
      throw new CalendarError('A sessão resultante deve ser um inteiro >= 1');
    }

    const updated = await client.query(
      `UPDATE world_calendar
       SET current_session = $1, updated_at = NOW(), updated_by = $2
       WHERE id = 1
       RETURNING *`,
      [newSession, userId],
    );

    await client.query(
      `INSERT INTO world_calendar_audit
         (previous_session, new_session, action, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [previousSession, newSession, action, userId],
    );

    await client.query('COMMIT');

    const finalRow = updated.rows[0];
    return {
      ...computeCalendarState(finalRow.current_session),
      updatedAt: finalRow.updated_at,
      updatedBy: finalRow.updated_by,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Avança a sessão corrente em 1. */
export function advanceSession(userId) {
  return applyChange((prev) => prev + 1, 'next', userId);
}

/** Volta a sessão corrente em 1 (nunca abaixo de 1). */
export function rewindSession(userId) {
  return applyChange((prev) => {
    if (prev <= 1) {
      throw new CalendarError('Já estamos na Sessão 1 — não é possível voltar mais.');
    }
    return prev - 1;
  }, 'previous', userId);
}

/** Define a sessão corrente para um valor específico (correção administrativa). */
export function setSession(session, userId) {
  return applyChange(() => session, 'set', userId);
}

/** Histórico de alterações do calendário (mais recentes primeiro). */
export async function getCalendarHistory(limit = 50) {
  const res = await query(
    `SELECT a.*, COALESCE(u.display_name, u.name) AS changed_by_name
     FROM world_calendar_audit a
     JOIN users u ON u.id = a.changed_by
     ORDER BY a.changed_at DESC
     LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    id:               r.id,
    previousSession:  r.previous_session,
    newSession:       r.new_session,
    action:           r.action,
    changedAt:        r.changed_at,
    changedBy: {
      id:          r.changed_by,
      displayName: r.changed_by_name,
    },
  }));
}
