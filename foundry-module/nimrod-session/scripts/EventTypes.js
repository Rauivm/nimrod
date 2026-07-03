/**
 * scripts/EventTypes.js
 *
 * Vocabulário único de eventType usado por todos os handlers/registries.
 * Existe para que nenhum handler invente sua própria string solta —
 * qualquer novo tipo de evento é adicionado aqui uma vez e reutilizado.
 *
 * Consumido pelo backend dentro de deltaMeta.event_type (ver nota de
 * persistência no topo de main.js).
 */
export const EventType = Object.freeze({
  // ── Sessão ──────────────────────────────────────────────────────────────
  SESSION_STARTED:        'SESSION_STARTED',
  SESSION_ENDED:           'SESSION_ENDED',

  // ── Presença ────────────────────────────────────────────────────────────
  PLAYER_CONNECTED:        'PLAYER_CONNECTED',
  PLAYER_DISCONNECTED:     'PLAYER_DISCONNECTED',
  PLAYER_RECONNECTED:      'PLAYER_RECONNECTED',
  PLAYER_IDLE:             'PLAYER_IDLE',
  PLAYER_ACTIVE:           'PLAYER_ACTIVE', // saiu do idle
  PLAYER_HEARTBEAT:        'PLAYER_HEARTBEAT',

  // ── Cena / Mapa ─────────────────────────────────────────────────────────
  SCENE_CHANGED:            'SCENE_CHANGED',       // GM ativou uma cena diferente
  PLAYER_VIEWED_SCENE:      'PLAYER_VIEWED_SCENE',  // canvasReady deste cliente

  // ── Tokens ──────────────────────────────────────────────────────────────
  TOKEN_APPEARED:           'TOKEN_APPEARED',
  TOKEN_REMOVED:            'TOKEN_REMOVED',

  // ── Combate ─────────────────────────────────────────────────────────────
  COMBAT_STARTED:           'COMBAT_STARTED',
  COMBAT_ENDED:             'COMBAT_ENDED',
  COMBAT_ENTERED:           'COMBAT_ENTERED',   // combatente adicionado
  COMBAT_EXITED:            'COMBAT_EXITED',    // combatente removido
  COMBAT_ROUND_CHANGED:     'COMBAT_ROUND_CHANGED',
  COMBAT_TURN_CHANGED:      'COMBAT_TURN_CHANGED',
  COMBAT_DEFEATED:          'COMBAT_DEFEATED',   // marcado como derrotado no tracker

  // ── Inventário ──────────────────────────────────────────────────────────
  ITEM_EQUIPPED:            'ITEM_EQUIPPED',
  ITEM_UNEQUIPPED:          'ITEM_UNEQUIPPED',
  ITEM_IDENTIFIED:          'ITEM_IDENTIFIED',
  ITEM_ATTUNED:             'ITEM_ATTUNED',
  ITEM_UNATTUNED:           'ITEM_UNATTUNED',

  // ── Features / habilidades ────────────────────────────────────────────
  FEATURE_USED:             'FEATURE_USED',
  FEATURE_RECOVERED:        'FEATURE_RECOVERED',

  // ── Magias ──────────────────────────────────────────────────────────────
  SPELL_CAST:                'SPELL_CAST',

  // ── Morte / condição ────────────────────────────────────────────────────
  DEATH_SAVE_SUCCESS:       'DEATH_SAVE_SUCCESS',
  DEATH_SAVE_FAILURE:       'DEATH_SAVE_FAILURE',
  UNCONSCIOUS:               'UNCONSCIOUS',
  DEAD:                      'DEAD',
  REVIVED:                   'REVIVED',

  // ── Descanso ────────────────────────────────────────────────────────────
  REST_COMPLETED:           'REST_COMPLETED',
});