export const MISSION_STATUSES = {
  OPEN: 'Aguardando início', CLOSED: 'Aguardando início', RUNNING: 'Em andamento',
  PAUSED: 'Entre sessões', FINISHED: 'Concluída', CANCELLED: 'Cancelada',
};

// Presentation mirrors registration state; the server remains authoritative.
export function registrationSummary(mission, now = Date.now()) {
  if (mission.kind === 'NOTICE') return { label: 'Aviso da comunidade', tone: 'info' };
  if (mission.status === 'FINISHED') return { label: 'Aventura concluída', tone: 'neutral' };
  if (mission.status === 'CANCELLED') return { label: 'Missão cancelada', tone: 'danger' };
  if (mission.user_approval_status === 'PENDING') return { label: 'Sua inscrição aguarda aprovação', tone: 'warning' };
  if (mission.user_joined) return { label: mission.user_is_reserve ? 'Você está na lista de espera' : 'Você está inscrito', tone: 'success' };
  const expired = mission.registration_deadline && new Date(mission.registration_deadline).getTime() <= now;
  if (!['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status) || !mission.registrations_open || expired)
    return { label: expired ? 'Prazo de inscrição encerrado' : 'Inscrições encerradas', tone: 'neutral' };
  const slots = Math.max(0, Number(mission.max_players) - Number(mission.player_count || 0));
  if (slots) return { label: `${slots} ${slots === 1 ? 'vaga disponível' : 'vagas disponíveis'}`, tone: 'success' };
  const reserves = Math.max(0, Number(mission.max_reserves) - Number(mission.reserve_count || 0));
  return reserves ? { label: 'Lista de espera disponível', tone: 'warning' } : { label: 'Grupo e lista de espera completos', tone: 'neutral' };
}

export function matchesMissionSearch(mission, search) {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const text = [mission.title, mission.description, mission.creator_name, mission.gm_name].map(normalize).join(' ');
  return normalize(search).trim().split(/\s+/).every(word => text.includes(word));
}
