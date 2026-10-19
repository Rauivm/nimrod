// Isolated suite: no .env, migrations or production database.
export default { test: { setupFiles: [], include: process.env.NIMROD_HUB_FULL_SUITE === '1' ? ['tests/**/*.test.js'] : ['tests/socialHub*.test.js'],
  pool: 'forks', minWorkers: 1, maxWorkers: 1, cache: false } };
