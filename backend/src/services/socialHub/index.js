import { query } from '../../db/index.js';
import { SocialHubRoom } from './Room.js';

const eligible = 'active = TRUE AND retired = FALSE AND COALESCE(dead, FALSE) = FALSE';
export const socialHubRoom = new SocialHubRoom({
  async loadCharacter(id, userId) {
    const result = await query({ text: `SELECT id, name, level, classe FROM player_characters WHERE id = $1 AND user_id = $2 AND ${eligible}`,
      values: [id, userId], query_timeout: 3000 });
    return result.rows[0] ?? null;
  },
  async revalidate(ids) {
    const result = await query({ text: `SELECT id, user_id, name, level, classe FROM player_characters WHERE id = ANY($1::uuid[]) AND ${eligible}`,
      values: [ids], query_timeout: 3000 });
    return result.rows;
  },
});
