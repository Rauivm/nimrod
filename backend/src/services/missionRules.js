import { isValidUuid } from '../lib/validation.js';
export function fail(statusCode, message) {
  throw Object.assign(new Error(message), {
    statusCode
  });
}
export function managesMission(mission, user) {
  return Boolean(user?.id && (mission.creator_id === user.id || mission.gm_id === user.id));
}
export function requireManager(mission, user) {
  if (!managesMission(mission, user)) fail(403, 'Apenas o criador ou o narrador designado pode administrar esta missão.');
}
export function integer(value, name, minimum = 1) {
  if (!['number','string'].includes(typeof value) || value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
    fail(400, `${name} deve ser um inteiro maior ou igual a ${minimum}.`);
  }
  return Number(value);
}
export function validateRequestBody(body) {
  if(body===undefined)return;
  if(body===null || typeof body!=='object' || Array.isArray(body))fail(400,'Corpo da requisição deve ser um objeto.');
  for(const field of ['title','description','reward','level','reason','code','summary','datetime','registrationDeadline','secret','worldId','foundryUserId']) {
    if(body[field]!=null && typeof body[field]!=='string')fail(400,`${field} deve ser texto.`);
  }
}
export function validateMissionFields(body, previous = null) {
  const field = (key, col) => body[key] !== undefined ? body[key] : previous?.[col];
  const maxPlayers = integer(field('maxPlayers', 'max_players') ?? 4, 'Máximo de jogadores');
  const maxReserves = integer(field('maxReserves', 'max_reserves') ?? 2, 'Reservas', 0);
  const minPlayers = integer(field('minPlayers', 'min_players'), 'Mínimo de jogadores');
  const minLevel = integer(field('minLevel', 'min_level'), 'Nível mínimo');
  const maxLevel = integer(field('maxLevel', 'max_level'), 'Nível máximo');
  if (minPlayers > maxPlayers || minLevel > maxLevel) fail(400, 'Os limites mínimos não podem superar os máximos.');
  const approval = field('approvalRequired', 'approval_required') ?? false;
  if (typeof approval !== 'boolean') fail(400, 'approvalRequired deve ser booleano.');
  return {
    minPlayers,
    maxPlayers,
    maxReserves,
    minLevel,
    maxLevel,
    approvalRequired: approval
  };
}
export function registrationsAllowed(mission) {
  return mission.kind !== 'NOTICE' && ['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status) && mission.registrations_open && (!mission.registration_deadline || new Date(mission.registration_deadline) > new Date());
}
export function requireRegistration(mission) {
  if (!registrationsAllowed(mission)) fail(409, 'Inscrições indisponíveis para esta missão.');
}
export function validateCharacter(mission, character, userId) {
  if (mission.min_level == null) fail(409, 'Configure a faixa de níveis desta missão legada antes de novas inscrições.');
  if (!character) {
    if (mission.min_level >= 4) fail(400, 'Esta missão exige personagem compatível.');
    return;
  }
  if (character.user_id !== userId || !character.active || character.retired || character.dead) fail(400, 'Personagem inválido ou não pertence à sua conta.');
  if (character.level < mission.min_level || mission.max_level != null && character.level > mission.max_level) fail(400, 'Personagem fora da faixa de níveis.');
}
export function requireUuid(value) {
  if (!isValidUuid(value)) fail(400, 'Identificador inválido.');
  return value;
}
