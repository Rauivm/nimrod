import { RewardFormulaRegistry } from './rewardFormulas.js';

/**
 * Registry of activity resolvers by ActivityType.
 */
export const ActivityResolverRegistry = new Map();

/**
 * Strategy implementation for Side Quests.
 */
class SideQuestResolver {
  /**
   * Calculates roll, modifier, and final contribution limit at join time.
   */
  resolve(character, rules) {
    const attribute = rules?.attribute || 'str';
    const abilities = character.abilities || {};

    const score = Number(abilities[attribute] ?? 10);
    const modifier = Math.floor((score - 10) / 2);

    // Roll 1d20
    const dice = Math.floor(Math.random() * 20) + 1;
    const total = dice + modifier;

    // Contribution capped at minimum of 0
    const contribution = Math.max(0, total);

    return {
      rolls: {
        dice,
        modifier,
        total,
      },
      contribution,
      effects: [],
      metadata: {
        testedAttribute: attribute,
        abilityScore: score,
      },
    };
  }

  /**
   * Calculates final rewards at activity completion time.
   */
  resolveRewards(participant, activity) {
    const formulaName = activity.rules?.rewardFormula || 'proportional';
    const formula = RewardFormulaRegistry.get(formulaName) || RewardFormulaRegistry.get('proportional');

    const rewards = formula(participant, activity);

    return {
      rewards,
      effects: [],
      metadata: {
        calculatedAt: new Date().toISOString(),
        formulaUsed: formulaName,
      },
    };
  }
}

// Register the resolver strategy
ActivityResolverRegistry.set('SIDE_QUEST', new SideQuestResolver());
