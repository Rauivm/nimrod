import { isGM } from '../lib/roles.js';

/**
 * Centralized service to manage activity-related permissions.
 */
export const ActivityPermissionService = {
  /**
   * Only GMs can create activities.
   */
  canCreate(user) {
    return isGM(user);
  },

  /**
   * Only GMs can manage, edit, cancel, or manually finish activities.
   */
  canManage(user, activity) {
    return isGM(user);
  },

  /**
   * Player validation check to join an activity.
   */
  canJoin(user, character, activity, currentParticipantsCount) {
    if (!user || !character || !activity) {
      return { allowed: false, error: 'Dados insuficientes para validação.' };
    }

    // Verify character ownership
    if (character.user_id !== user.id) {
      return { allowed: false, error: 'Este personagem não está vinculado ao seu usuário.' };
    }

    // Verify character viability
    if (!character.active || character.retired || character.dead) {
      return { allowed: false, error: 'Personagem deve estar ativo, vivo e não-aposentado.' };
    }

    // Verify activity is open
    if (activity.status !== 'WAITING' && activity.status !== 'RUNNING') {
      return { allowed: false, error: `Atividade não está aberta para inscrições (status: ${activity.status}).` };
    }

    // Verify date constraints
    const now = new Date();
    const startsAt = new Date(activity.starts_at);
    const endsAt = new Date(activity.ends_at);

    if (now < startsAt) {
      return { allowed: false, error: 'Esta atividade ainda não iniciou.' };
    }
    if (now >= endsAt) {
      return { allowed: false, error: 'Esta atividade já encerrou.' };
    }

    // Verify participant capacity limits
    if (activity.max_participants > 0 && currentParticipantsCount >= activity.max_participants) {
      return { allowed: false, error: 'Esta atividade já atingiu o limite máximo de participantes.' };
    }

    return { allowed: true };
  }
};
