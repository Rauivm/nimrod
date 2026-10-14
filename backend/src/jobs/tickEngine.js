/**
 * tickEngine.js
 *
 * Scheduler periódico que executa dois trabalhos de manutenção:
 *
 *   1. Auto-encerramento: atividades WAITING ou RUNNING cujo ends_at já
 *      passou são encerradas automaticamente com status FINISHED.
 *
 *   2. Progresso visual: para cada participante JOINED, incrementa
 *      contribution_current em direção ao valor final de contribution.
 *      Isso cria uma animação de "progresso chegando" na UI sem alterar
 *      os valores matemáticos travados no join.
 *
 * Configuração via variável de ambiente:
 *   ACTIVITY_TICK_INTERVAL=60000   (ms, padrão: 60 segundos)
 *
 * Nota: o TickEngine acessa o banco diretamente com queries simples
 * para evitar dependência circular com ActivityEngine.
 */

import { pool, query } from '../db/index.js';
import { emitActivityEvent } from '../lib/events.js';

// Quantos ticks são esperados até o progresso visual completar
// (progress animation spreads over this many ticks)
const VISUAL_TICKS_TOTAL = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Tick principal
// ─────────────────────────────────────────────────────────────────────────────

async function runTick() {
  try {
    await autoCloseExpired();
    await updateVisualProgress();
  } catch (err) {
    console.error('[TickEngine] Erro no tick:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-encerramento de atividades expiradas
// ─────────────────────────────────────────────────────────────────────────────

async function autoCloseExpired() {
  // Buscar atividades que deveriam ter encerrado
  const expired = await query(
    `SELECT id, activity_type, rules FROM activities
      WHERE status IN ('WAITING', 'RUNNING')
        AND ends_at <= NOW()`,
  );

  if (expired.rowCount === 0) return;

  for (const act of expired.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock e re-verificar status (pode ter sido encerrado manualmente entre queries)
      const lockRes = await client.query(
        `SELECT id, status FROM activities WHERE id = $1 FOR UPDATE`,
        [act.id]
      );
      if (lockRes.rowCount === 0 || !['WAITING', 'RUNNING'].includes(lockRes.rows[0].status)) {
        await client.query('ROLLBACK');
        continue;
      }

      if (act.rules?.execution_mode === 'mana') {
        await client.query(`UPDATE activity_participants SET status = 'FAILED'
          WHERE activity_id = $1 AND status = 'JOINED'`, [act.id]);
        await client.query(`UPDATE activities SET status = 'FAILED', version = version + 1,
          updated_at = NOW() WHERE id = $1`, [act.id]);
        await client.query('COMMIT');
        emitActivityEvent({ type: 'activity.finished', actorId: null, entityId: act.id,
          payload: { expired: true }, newState: { status: 'FAILED' } });
        continue;
      }

      // Marcar participantes ainda ativos como COMPLETED
      await client.query(
        `UPDATE activity_participants
            SET status = 'COMPLETED'
          WHERE activity_id = $1 AND status = 'JOINED'`,
        [act.id]
      );

      // Buscar participantes para gerar relatório inline
      const partRes = await client.query(
        `SELECT ap.*, pc.name AS character_name
           FROM activity_participants ap
           JOIN player_characters pc ON pc.id = ap.character_id
          WHERE ap.activity_id = $1`,
        [act.id]
      );

      // Gerar relatório diretamente (import dinâmico para evitar circular)
      const { ReportEngine } = await import('./reportEngine.js');
      const actRes = await client.query(`SELECT * FROM activities WHERE id = $1`, [act.id]);
      const report = ReportEngine.generate(actRes.rows[0], partRes.rows);

      // Encerrar atividade
      await client.query(
        `UPDATE activities
            SET status              = 'FINISHED',
                report              = $1,
                report_generated_at = NOW(),
                version             = version + 1,
                updated_at          = NOW()
          WHERE id = $2`,
        [JSON.stringify(report), act.id]
      );

      await client.query('COMMIT');

      emitActivityEvent({
        type:     'activity.finished',
        actorId:  null,
        entityId: act.id,
        payload:  { autoClose: true },
        oldState: { status: 'RUNNING' },
        newState: { status: 'FINISHED' },
      });

      console.log(`[TickEngine] Atividade auto-encerrada: ${act.id}`);

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[TickEngine] Erro ao encerrar atividade ${act.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Atualização de progresso visual (contribution_current)
// ─────────────────────────────────────────────────────────────────────────────

async function updateVisualProgress() {
  // Buscar participantes cujo progresso visual ainda não chegou ao final
  const res = await query(
    `SELECT ap.id, ap.contribution, ap.contribution_current
       FROM activity_participants ap
       JOIN activities a ON a.id = ap.activity_id
      WHERE ap.status = 'JOINED'
        AND a.status IN ('WAITING', 'RUNNING')
        AND ap.contribution_current < ap.contribution`
  );

  if (res.rowCount === 0) return;

  for (const p of res.rows) {
    // Calcular incremento por tick (ao menos 1 para sempre progredir)
    const step = Math.max(1, Math.ceil(Number(p.contribution) / VISUAL_TICKS_TOTAL));
    const next = Math.min(Number(p.contribution_current) + step, Number(p.contribution));

    await query(
      `UPDATE activity_participants
          SET contribution_current = $1
        WHERE id = $2`,
      [next, p.id]
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inicialização
// ─────────────────────────────────────────────────────────────────────────────

export function startTickEngine() {
  const interval = parseInt(process.env.ACTIVITY_TICK_INTERVAL) || 60_000;
  setInterval(runTick, interval);
  console.log(`✓ TickEngine agendado a cada ${interval}ms`);
}
