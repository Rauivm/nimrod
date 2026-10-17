// Explicit opt-in suite: never loads the project's .env or default setup.
export default {
  test: {
    setupFiles: [],
    include: ['tests/missionBoard.integration.test.js'],
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 1,
    cache: false,
  },
};
