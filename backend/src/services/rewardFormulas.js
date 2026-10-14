/**
 * Registry mapping formula identifiers to calculation strategies.
 */
export const RewardFormulaRegistry = new Map();

// 1. Proportional formula strategy
RewardFormulaRegistry.set('proportional', (participant, activity) => {
  const params = activity.rules?.rewardParameters || {};
  const xpMax = Number(params.xp_max ?? 0);
  const goldMax = Number(params.gold_max ?? 0);

  // Ratio based on contribution out of a standard d20 target (20)
  const ratio = Math.max(0, Math.min(1.0, (participant.contribution ?? 0) / 20));

  const xp = Math.round(ratio * xpMax);
  const gold = Math.round(ratio * goldMax);

  const rewards = [];
  if (xp > 0) rewards.push({ type: 'xp', amount: xp });
  if (gold > 0) rewards.push({ type: 'gold', amount: gold });

  return rewards;
});

// 2. Flat formula strategy (gives full rewards regardless of roll)
RewardFormulaRegistry.set('flat', (participant, activity) => {
  const params = activity.rules?.rewardParameters || {};
  const xp = Number(params.xp_max ?? 0);
  const gold = Number(params.gold_max ?? 0);

  const rewards = [];
  if (xp > 0) rewards.push({ type: 'xp', amount: xp });
  if (gold > 0) rewards.push({ type: 'gold', amount: gold });

  return rewards;
});

// 3. Mock Winner Takes All (just for registry completeness demonstration)
RewardFormulaRegistry.set('winner_takes_all', (participant, activity) => {
  // Returns rewards only if participant contribution is the maximum in the activity (can be implemented in future phase)
  const params = activity.rules?.rewardParameters || {};
  const xp = Number(params.xp_max ?? 0);
  const gold = Number(params.gold_max ?? 0);

  return [
    { type: 'xp', amount: xp },
    { type: 'gold', amount: gold }
  ];
});
