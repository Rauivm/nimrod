// Experimental identity and destinations live here, independently of Mana's configuration.
export const hubConfig = Object.freeze({
  identity: Object.freeze({
    name: 'Taverna Nimrod',
    description: 'Um novo espaço de encontro para a comunidade, dentro da sua conta Nimrod.',
    stage: 'Experimental · Sprint 7',
  }),
  routes: Object.freeze({
    html5: '/lobby/html5',
    mana: '/lobby',
    classic: '/?experience=classic',
    missions: '/missions',
    profile: '/profile',
    foundryConnection: '/foundry-connect',
  }),
  renderer: Object.freeze({
    background: 0x191610,
    maxResolution: 2,
  }),
});
