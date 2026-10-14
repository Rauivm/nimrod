/**
 * Structured report generator for completed activities.
 */
export const ReportEngine = {
  /**
   * Generates a standardized, immutable JSON report payload.
   *
   * @param {object} activity - DB row of the activity
   * @param {Array<object>} participants - Array of participant rows (including character_name, contribution, reward_data)
   * @returns {object}
   */
  generate(activity, participants = []) {
    const totalJoined = participants.length;
    const goalMet = Number(activity.progress) >= Number(activity.goal);

    const summary = {
      activityId: activity.id,
      title: activity.title,
      description: activity.description,
      activityType: activity.activity_type,
      status: activity.status,
      startsAt: activity.starts_at,
      endsAt: activity.ends_at,
      goal: activity.goal,
      progress: activity.progress,
    };

    const formattedParticipants = participants.map(p => ({
      characterId: p.character_id,
      characterName: p.character_name || null,
      contribution: p.contribution,
      joinedAt: p.joined_at,
      status: p.status,
    }));

    const statistics = {
      totalJoined,
      goalMet,
      totalContribution: activity.progress,
      efficiency: totalJoined > 0 ? parseFloat((activity.progress / totalJoined).toFixed(2)) : 0,
    };

    const rewards = participants.map(p => ({
      characterId: p.character_id,
      rewardData: p.reward_data || [],
    }));

    return {
      summary,
      participants: formattedParticipants,
      statistics,
      rewards,
    };
  }
};
