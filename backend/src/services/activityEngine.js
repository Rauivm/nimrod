/**
 * activityEngine.js
 *
 * Núcleo transacional do sistema de atividades.
 * Toda mutação de estado passa por aqui — nunca diretamente pelas rotas.
 *
 * Fluxo de inscrição (join):
 *   1. SELECT ... FOR UPDATE  — pessimistic lock na linha da atividade
 *   2. Validar permissão via ActivityPermissionService
 *   3. Resolver contribution via ActivityResolverRegistry (roll + modifier)
 *   4. Capar contribution ao remaining (goal - progress)
 *   5. INSERT em activity_participants (contribution = final, contribution_current = 0)
 *   6. UPDATE activities.progress
 *   7. emitActivityEvent('player.joined', ...)
 *
 * Fluxo de encerramento (finish):
 *   1. SELECT ... FOR UPDATE
 *   2. Para cada participant JOINED: resolveRewards → UPDATE reward_data + status = COMPLETED
 *   3. Gerar report via ReportEngine
 *   4. UPDATE activities SET status = FINISHED, report = ?, report_generated_at = NOW()
 *   5. emitActivityEvent('activity.finished', ...)
 */

import { pool, query } from '../db/index.js';
import { ActivityResolverRegistry } from './activityResolvers.js';
import { ReportEngine } from './reportEngine.js';
import { ActivityPermissionService } from './activityPermission.js';
import { emitActivityEvent } from '../lib/events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function serializeActivity(row) {
  return {
    id:                  row.id,
    title:               row.title,
    description:         row.description,
    activityType:        row.activity_type,
    status:              row.status,
    startsAt:            row.starts_at,
    endsAt:              row.ends_at,
    goal:                Number(row.goal),
    progress:            Number(row.progress),
    maxParticipants:     Number(row.max_participants),
    rules:               row.rules       ?? {},
    rewards:             row.rewards     ?? [],
    report:              row.report      ?? null,
    reportGeneratedAt:   row.report_generated_at ?? null,
    version:             row.version,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
    createdBy:           row.created_by,
  };
}

function serializeParticipant(row) {
  return {
    id:                  row.id,
    activityId:          row.activity_id,
    characterId:         row.character_id,
    characterName:       row.character_name ?? null,
    dice:                row.dice,
    modifier:            row.modifier,
    total:               row.total,
    contribution:        Number(row.contribution),
    contributionCurrent: Number(row.contribution_current),
    status:              row.status,
    rewardData:          row.reward_data ?? [],
    joinedAt:            row.joined_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ActivityEngine
// ─────────────────────────────────────────────────────────────────────────────

export const ActivityEngine = {

  // ── create ────────────────────────────────────────────────────────────────

  /**
   * Cria uma nova atividade. Apenas GMs.
   *
   * @param {object} user    - req.user
   * @param {object} data    - body validado
   * @returns {object}       - atividade serializada
   */
  async create(user, data) {
    if (!ActivityPermissionService.canCreate(user)) {
      const err = new Error('Apenas GMs podem criar atividades.');
      err.statusCode = 403;
      throw err;
    }

    const {
      title,
      description,
      activity_type = 'SIDE_QUEST',
      starts_at,
      ends_at,
      goal,
      max_participants = 0,
      rules = {},
      rewards = [],
    } = data;

    if (rules.execution_mode === 'mana') {
      if (activity_type !== 'SIDE_QUEST' || !title?.trim() || !description?.trim() ||
          !Number.isFinite(Date.parse(starts_at)) || !Number.isFinite(Date.parse(ends_at)) ||
          Date.parse(ends_at) <= Date.parse(starts_at) || !Number.isInteger(Number(goal)) || Number(goal) < 1) {
        throw Object.assign(new Error('Dados da side quest Mana inválidos.'), { statusCode: 400 });
      }
      if (rewards.length || rules.rewardParameters || rules.rewardFormula) {
        throw Object.assign(new Error('Recompensas de D&D não são concedidas pelo jogo 2D.'), { statusCode: 400 });
      }
    }

    const res = await query(
      `INSERT INTO activities
         (title, description, activity_type, starts_at, ends_at, goal, max_participants, created_by, rules, rewards)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [title, description, activity_type, starts_at, ends_at, goal, max_participants, user.id, JSON.stringify(rules), JSON.stringify(rewards)]
    );

    const activity = res.rows[0];

    emitActivityEvent({
      type:     'activity.created',
      actorId:  user.id,
      entityId: activity.id,
      payload:  { title, activity_type },
      newState: { status: 'WAITING' },
    });

    return serializeActivity(activity);
  },

  // ── list ─────────────────────────────────────────────────────────────────

  /**
   * Lista atividades com filtros opcionais de status e tipo.
   *
   * @param {object} filters - { status, activityType, limit, offset }
   * @returns {object[]}
   */
  async list({ status, activityType, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      const statuses = status.split(',').map(s => s.trim().toUpperCase());
      conditions.push(`a.status = ANY($${idx}::activity_status_enum[])`);
      params.push(statuses);
      idx++;
    }

    if (activityType) {
      conditions.push(`a.activity_type = $${idx}::activity_type_enum`);
      params.push(activityType.toUpperCase());
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const res = await query(
      `SELECT a.*,
              COUNT(ap.id)::int AS participant_count
         FROM activities a
         LEFT JOIN activity_participants ap ON ap.activity_id = a.id
         ${where}
         GROUP BY a.id
         ORDER BY a.starts_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return res.rows.map(r => ({
      ...serializeActivity(r),
      participantCount: r.participant_count,
    }));
  },

  // ── findById ─────────────────────────────────────────────────────────────

  /**
   * Retorna atividade completa com lista de participantes.
   *
   * @param {string} activityId
   * @returns {{ activity: object, participants: object[] }}
   */
  async findById(activityId) {
    const actRes = await query(
      `SELECT * FROM activities WHERE id = $1`,
      [activityId]
    );

    if (actRes.rowCount === 0) {
      const err = new Error('Atividade não encontrada.');
      err.statusCode = 404;
      throw err;
    }

    const partRes = await query(
      `SELECT ap.*, pc.name AS character_name
         FROM activity_participants ap
         JOIN player_characters pc ON pc.id = ap.character_id
        WHERE ap.activity_id = $1
        ORDER BY ap.joined_at`,
      [activityId]
    );

    return {
      activity:     serializeActivity(actRes.rows[0]),
      participants: partRes.rows.map(serializeParticipant),
    };
  },

  // ── join ─────────────────────────────────────────────────────────────────

  /**
   * Inscreve um personagem em uma atividade com lock transacional.
   *
   * @param {object} user         - req.user
   * @param {string} activityId
   * @param {string} characterId
   * @returns {object}            - participante serializado
   */
  async join(user, activityId, characterId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock pessimista na atividade
      const actRes = await client.query(
        `SELECT * FROM activities WHERE id = $1 FOR UPDATE`,
        [activityId]
      );
      if (actRes.rowCount === 0) {
        const err = new Error('Atividade não encontrada.');
        err.statusCode = 404;
        throw err;
      }
      const activity = actRes.rows[0];

      // 2. Buscar personagem (com ownership check)
      const charRes = await client.query(
        `SELECT pc.*, u.id AS user_id_check
           FROM player_characters pc
           JOIN users u ON u.id = pc.user_id
          WHERE pc.id = $1`,
        [characterId]
      );
      if (charRes.rowCount === 0) {
        const err = new Error('Personagem não encontrado.');
        err.statusCode = 404;
        throw err;
      }
      const character = charRes.rows[0];

      // 3. Verificar duplicidade
      const dupRes = await client.query(
        `SELECT 1 FROM activity_participants WHERE activity_id = $1 AND character_id = $2`,
        [activityId, characterId]
      );
      if (dupRes.rowCount > 0) {
        const err = new Error('Este personagem já está inscrito nesta atividade.');
        err.statusCode = 409;
        throw err;
      }

      // 4. Contar participantes atuais para verificação de capacidade
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM activity_participants WHERE activity_id = $1`,
        [activityId]
      );
      const currentCount = countRes.rows[0].cnt;

      // 5. Validar permissão
      const permission = ActivityPermissionService.canJoin(user, character, activity, currentCount);
      if (!permission.allowed) {
        const err = new Error(permission.error);
        err.statusCode = 403;
        throw err;
      }

      // 6. Resolver contribution via Strategy Registry
      const resolver = ActivityResolverRegistry.get(activity.activity_type);
      if (!resolver) {
        const err = new Error(`Nenhum resolver registrado para o tipo "${activity.activity_type}".`);
        err.statusCode = 500;
        throw err;
      }

      const resolved = activity.rules?.execution_mode === 'mana'
        ? { rolls: { dice: 0, modifier: 0, total: 0 }, contribution: 0 }
        : resolver.resolve(character, activity.rules ?? {});
      const { dice, modifier, total } = resolved.rolls;
      const rawContribution = resolved.contribution;

      // 7. Capar contribuição ao remaining
      const remaining = Number(activity.goal) - Number(activity.progress);
      const contribution = Math.max(0, Math.min(rawContribution, remaining));

      // 8. Inserir participante (contribution_current começa em 0 — atualizado pelo TickEngine)
      const partRes = await client.query(
        `INSERT INTO activity_participants
           (activity_id, character_id, dice, modifier, total, contribution, contribution_current)
         VALUES ($1,$2,$3,$4,$5,$6,0)
         RETURNING *`,
        [activityId, characterId, dice, modifier, total, contribution]
      );
      const participant = partRes.rows[0];

      // 9. Atualizar progress da atividade
      await client.query(
        `UPDATE activities
            SET progress   = progress + $1,
                version    = version + 1,
                updated_at = NOW()
          WHERE id = $2`,
        [contribution, activityId]
      );

      await client.query('COMMIT');

      emitActivityEvent({
        type:     'player.joined',
        actorId:  user.id,
        entityId: activityId,
        payload:  { characterId, dice, modifier, total, contribution },
        oldState: { progress: Number(activity.progress) },
        newState: { progress: Number(activity.progress) + contribution },
      });

      return {
        ...serializeParticipant({ ...participant, character_name: character.name }),
        rolls: { dice, modifier, total },
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ── cancel ────────────────────────────────────────────────────────────────

  /**
   * Cancela uma atividade. Apenas GMs.
   *
   * @param {object} user
   * @param {string} activityId
   * @returns {object} - atividade serializada
   */
  async cancel(user, activityId) {
    if (!ActivityPermissionService.canManage(user)) {
      const err = new Error('Apenas GMs podem cancelar atividades.');
      err.statusCode = 403;
      throw err;
    }

    const actRes = await query(
      `SELECT * FROM activities WHERE id = $1`,
      [activityId]
    );
    if (actRes.rowCount === 0) {
      const err = new Error('Atividade não encontrada.');
      err.statusCode = 404;
      throw err;
    }
    const activity = actRes.rows[0];

    if (activity.status === 'CANCELLED' || activity.status === 'FINISHED') {
      const err = new Error(`Não é possível cancelar uma atividade com status "${activity.status}".`);
      err.statusCode = 400;
      throw err;
    }

    const res = await query(
      `UPDATE activities
          SET status     = 'CANCELLED',
              version    = version + 1,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [activityId]
    );

    emitActivityEvent({
      type:     'activity.cancelled',
      actorId:  user.id,
      entityId: activityId,
      payload:  {},
      oldState: { status: activity.status },
      newState: { status: 'CANCELLED' },
    });

    return serializeActivity(res.rows[0]);
  },

  // ── finish ────────────────────────────────────────────────────────────────

  /**
   * Encerra manualmente uma atividade, gera recompensas e relatório. Apenas GMs.
   *
   * @param {object} user
   * @param {string} activityId
   * @returns {{ activity: object, report: object }}
   */
  async finish(user, activityId) {
    if (!ActivityPermissionService.canManage(user)) {
      const err = new Error('Apenas GMs podem encerrar atividades.');
      err.statusCode = 403;
      throw err;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock na atividade
      const actRes = await client.query(
        `SELECT * FROM activities WHERE id = $1 FOR UPDATE`,
        [activityId]
      );
      if (actRes.rowCount === 0) {
        const err = new Error('Atividade não encontrada.');
        err.statusCode = 404;
        throw err;
      }
      const activity = actRes.rows[0];

      if (activity.status === 'FINISHED' || activity.status === 'CANCELLED') {
        const err = new Error(`Atividade já está com status "${activity.status}".`);
        err.statusCode = 400;
        throw err;
      }

      if (activity.rules?.execution_mode === 'mana') {
        throw Object.assign(new Error('A conclusão do jogo 2D requer objetivos validados pelo servidor; não há conclusão automática.'), { statusCode: 409 });
      }

      // 2. Buscar participantes ativos
      const partRes = await client.query(
        `SELECT ap.*, pc.name AS character_name
           FROM activity_participants ap
           JOIN player_characters pc ON pc.id = ap.character_id
          WHERE ap.activity_id = $1 AND ap.status = 'JOINED'
          FOR UPDATE OF ap`,
        [activityId]
      );
      const participants = partRes.rows;

      // 3. Resolver recompensas para cada participante
      const resolver = ActivityResolverRegistry.get(activity.activity_type);

      for (const p of participants) {
        let rewardData = [];

        if (resolver) {
          const result = resolver.resolveRewards(p, activity);
          rewardData = result.rewards;
        }

        await client.query(
          `UPDATE activity_participants
              SET status      = 'COMPLETED',
                  reward_data = $1
            WHERE id = $2`,
          [JSON.stringify(rewardData), p.id]
        );

        p.reward_data = rewardData;
        p.status = 'COMPLETED';
      }

      // 4. Gerar relatório imutável a partir do estado mais recente da atividade
      const reportActivityRes = await client.query(
        `SELECT * FROM activities WHERE id = $1`,
        [activityId]
      );
      const reportActivity = reportActivityRes.rows[0] ?? activity;
      const report = ReportEngine.generate(reportActivity, participants);

      // 5. Atualizar atividade para FINISHED
      const updatedRes = await client.query(
        `UPDATE activities
            SET status               = 'FINISHED',
                report               = $1,
                report_generated_at  = NOW(),
                version              = version + 1,
                updated_at           = NOW()
          WHERE id = $2
          RETURNING *`,
        [JSON.stringify(report), activityId]
      );

      await client.query('COMMIT');

      emitActivityEvent({
        type:     'activity.finished',
        actorId:  user.id,
        entityId: activityId,
        payload:  { participantCount: participants.length },
        oldState: { status: activity.status },
        newState: { status: 'FINISHED' },
      });

      return {
        activity: serializeActivity(updatedRes.rows[0]),
        report,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ── getReport ────────────────────────────────────────────────────────────

  /**
   * Retorna o relatório final de uma atividade encerrada.
   *
   * @param {string} activityId
   * @returns {object}
   */
  async getReport(activityId) {
    const res = await query(
      `SELECT report, report_generated_at, status FROM activities WHERE id = $1`,
      [activityId]
    );

    if (res.rowCount === 0) {
      const err = new Error('Atividade não encontrada.');
      err.statusCode = 404;
      throw err;
    }

    const row = res.rows[0];

    if (row.status !== 'FINISHED') {
      const err = new Error('Relatório disponível apenas após o encerramento da atividade.');
      err.statusCode = 400;
      throw err;
    }

    return {
      report:            row.report,
      reportGeneratedAt: row.report_generated_at,
    };
  },
};
