import { EventEmitter } from 'events';
import { query } from '../db/index.js';

export const activityEvents = new EventEmitter();

/**
 * Standardized event formatter and publisher.
 */
export function emitActivityEvent({
  type,
  actorId = null,
  entityId = null,
  payload = {},
  oldState = null,
  newState = null,
  requestId = null,
  correlationId = null
}) {
  const event = {
    type,
    occurredAt: new Date().toISOString(),
    actorId,
    entityId,
    payload,
  };

  // Publish to local subscribers
  activityEvents.emit(type, event, { oldState, newState, requestId, correlationId });
}

// Audited events registered in db logs
const AUDITED_EVENTS = [
  'activity.created',
  'activity.started',
  'player.joined',
  'activity.progress',
  'activity.finished',
  'activity.cancelled',
  'reward.generated',
  'reward.claimed',
];

for (const type of AUDITED_EVENTS) {
  activityEvents.on(type, async (event, meta) => {
    try {
      const { oldState, newState, requestId, correlationId } = meta || {};
      await query(
        `INSERT INTO activity_logs (
          activity_id, user_id, event_type, old_state, new_state, request_id, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.entityId,
          event.actorId,
          event.type,
          oldState ? JSON.stringify(oldState) : null,
          newState ? JSON.stringify(newState) : null,
          requestId || null,
          correlationId || null,
        ]
      );
    } catch (err) {
      console.error(`[event-bus-audit] Failed to write audit log for ${type}:`, err.message);
    }
  });
}
