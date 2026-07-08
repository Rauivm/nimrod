/**
 * src/services/seasonEffectsService.js
 *
 * CRUD dos efeitos mecânicos de cada estação (season_effects).
 *
 * Diferente do CalendarService (que só calcula ano/estação/semana a partir
 * da sessão), este serviço lida com dados que o GM edita livremente —
 * balanceamento de jogo, não é derivado de nada.
 *
 * Três tipos de efeito (ver migration 028 para detalhes):
 *   'check'  → perícia + vantagem/desvantagem
 *   'price'  → categoria de preço + multiplicador
 *   'custom' → só texto de lore
 */

import { query, pool } from '../db/index.js';
import { CalendarError } from './calendarService.js';

const VALID_SEASON_KEYS = ['WINTER', 'SPRING', 'SUMMER', 'AUTUMN'];
const VALID_KINDS       = ['check', 'price', 'custom'];
const VALID_MODES       = ['advantage', 'disadvantage'];

function toApiShape(row) {
  return {
    id: row.id,
    seasonKey: row.season_key,
    kind: row.kind,
    label: row.label,
    skill: row.skill,
    mode: row.mode,
    priceCategory: row.price_category,
    priceMultiplier: row.price_multiplier !== null ? Number(row.price_multiplier) : null,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

function validatePayload({ seasonKey, kind, label, skill, mode, priceCategory, priceMultiplier }) {
  if (!VALID_SEASON_KEYS.includes(seasonKey)) {
    throw new CalendarError(`season_key inválido: "${seasonKey}"`);
  }
  if (!VALID_KINDS.includes(kind)) {
    throw new CalendarError(`kind inválido: "${kind}"`);
  }
  if (!label || typeof label !== 'string' || !label.trim()) {
    throw new CalendarError('label é obrigatório');
  }
  if (kind === 'check') {
    if (!skill || typeof skill !== 'string' || !skill.trim()) {
      throw new CalendarError('skill é obrigatório para efeitos do tipo "check"');
    }
    if (!VALID_MODES.includes(mode)) {
      throw new CalendarError('mode deve ser "advantage" ou "disadvantage" para efeitos do tipo "check"');
    }
  }
  if (kind === 'price') {
    if (!priceCategory || typeof priceCategory !== 'string' || !priceCategory.trim()) {
      throw new CalendarError('priceCategory é obrigatório para efeitos do tipo "price"');
    }
    if (typeof priceMultiplier !== 'number' || !(priceMultiplier > 0)) {
      throw new CalendarError('priceMultiplier deve ser um número > 0 para efeitos do tipo "price"');
    }
  }
}

/** Lista todos os efeitos de todas as estações, agrupados por season_key. */
export async function listAllEffects() {
  const res = await query(
    'SELECT * FROM season_effects ORDER BY season_key, sort_order, created_at',
  );
  const grouped = { WINTER: [], SPRING: [], SUMMER: [], AUTUMN: [] };
  for (const row of res.rows) {
    grouped[row.season_key].push(toApiShape(row));
  }
  return grouped;
}

/** Lista os efeitos de uma única estação, na ordem de exibição. */
export async function listEffectsBySeason(seasonKey) {
  const res = await query(
    'SELECT * FROM season_effects WHERE season_key = $1 ORDER BY sort_order, created_at',
    [seasonKey],
  );
  return res.rows.map(toApiShape);
}

/** Cria um novo efeito. Vai para o final da lista da estação. */
export async function createEffect(payload, userId) {
  validatePayload(payload);
  const { seasonKey, kind, label, skill = null, mode = null, priceCategory = null, priceMultiplier = null } = payload;

  const maxOrder = await query(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM season_effects WHERE season_key = $1',
    [seasonKey],
  );
  const nextOrder = maxOrder.rows[0].max_order + 1;

  const res = await query(
    `INSERT INTO season_effects
       (season_key, kind, label, skill, mode, price_category, price_multiplier, sort_order, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [seasonKey, kind, label.trim(), skill, mode, priceCategory, priceMultiplier, nextOrder, userId],
  );
  return toApiShape(res.rows[0]);
}

/** Atualiza um efeito existente (edição parcial). */
export async function updateEffect(id, payload, userId) {
  const existing = await query('SELECT * FROM season_effects WHERE id = $1', [id]);
  if (existing.rowCount === 0) {
    throw new CalendarError('Efeito não encontrado', 404);
  }
  const current = toApiShape(existing.rows[0]);

  const merged = {
    seasonKey: payload.seasonKey ?? current.seasonKey,
    kind: payload.kind ?? current.kind,
    label: payload.label ?? current.label,
    skill: payload.skill !== undefined ? payload.skill : current.skill,
    mode: payload.mode !== undefined ? payload.mode : current.mode,
    priceCategory: payload.priceCategory !== undefined ? payload.priceCategory : current.priceCategory,
    priceMultiplier: payload.priceMultiplier !== undefined ? payload.priceMultiplier : current.priceMultiplier,
  };
  validatePayload(merged);

  const res = await query(
    `UPDATE season_effects
     SET season_key = $1, kind = $2, label = $3, skill = $4, mode = $5,
         price_category = $6, price_multiplier = $7, updated_at = NOW(), updated_by = $8
     WHERE id = $9
     RETURNING *`,
    [
      merged.seasonKey, merged.kind, merged.label.trim(), merged.skill, merged.mode,
      merged.priceCategory, merged.priceMultiplier, userId, id,
    ],
  );
  return toApiShape(res.rows[0]);
}

/** Remove um efeito. */
export async function deleteEffect(id) {
  const res = await query('DELETE FROM season_effects WHERE id = $1 RETURNING id', [id]);
  if (res.rowCount === 0) {
    throw new CalendarError('Efeito não encontrado', 404);
  }
}

/**
 * Move um efeito uma posição pra cima ou pra baixo dentro da mesma estação,
 * trocando sort_order com o vizinho.
 */
export async function moveEffect(id, direction) {
  if (direction !== 'up' && direction !== 'down') {
    throw new CalendarError('direction deve ser "up" ou "down"');
  }

  const client = await pool.connect();
  let seasonKey;
  try {
    await client.query('BEGIN');

    const currentRes = await client.query('SELECT * FROM season_effects WHERE id = $1 FOR UPDATE', [id]);
    if (currentRes.rowCount === 0) {
      throw new CalendarError('Efeito não encontrado', 404);
    }
    const current = currentRes.rows[0];
    seasonKey = current.season_key;

    const neighborRes = await client.query(
      `SELECT * FROM season_effects
       WHERE season_key = $1 AND sort_order ${direction === 'up' ? '<' : '>'} $2
       ORDER BY sort_order ${direction === 'up' ? 'DESC' : 'ASC'}
       LIMIT 1
       FOR UPDATE`,
      [current.season_key, current.sort_order],
    );

    if (neighborRes.rowCount > 0) {
      const neighbor = neighborRes.rows[0];
      await client.query('UPDATE season_effects SET sort_order = $1 WHERE id = $2', [neighbor.sort_order, current.id]);
      await client.query('UPDATE season_effects SET sort_order = $1 WHERE id = $2', [current.sort_order, neighbor.id]);
    }
    // Se não há vizinho (já está na ponta), não faz nada — só confirma a transação.

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return listEffectsBySeason(seasonKey);
}
