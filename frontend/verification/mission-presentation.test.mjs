import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationSummary, matchesMissionSearch } from '../src/lib/missionPresentation.js';

const mission = { kind: 'MISSION', status: 'OPEN', registrations_open: true, player_count: 2, max_players: 4, reserve_count: 0, max_reserves: 2 };
test('availability distinguishes a real slot, waitlist and complete group', () => {
  assert.equal(registrationSummary(mission).label, '2 vagas disponíveis');
  assert.equal(registrationSummary({ ...mission, player_count: 4 }).label, 'Lista de espera disponível');
  assert.equal(registrationSummary({ ...mission, player_count: 4, reserve_count: 2 }).label, 'Grupo e lista de espera completos');
});
test('approval and reserve membership are never presented as a confirmed player slot', () => {
  assert.equal(registrationSummary({ ...mission, user_joined: true, user_approval_status: 'PENDING' }).label, 'Sua inscrição aguarda aprovação');
  assert.equal(registrationSummary({ ...mission, user_joined: true, user_is_reserve: true }).label, 'Você está na lista de espera');
});
test('deadline, lifecycle and registration switch are independent', () => {
  assert.equal(registrationSummary({ ...mission, status: 'PAUSED' }).tone, 'success');
  assert.equal(registrationSummary({ ...mission, status: 'CLOSED' }).tone, 'success');
  assert.equal(registrationSummary({ ...mission, registrations_open: false }).label, 'Inscrições encerradas');
  assert.equal(registrationSummary({ ...mission, registration_deadline: '2026-01-01' }, Date.parse('2026-02-01')).label, 'Prazo de inscrição encerrado');
  for (const status of ['RUNNING', 'FINISHED', 'CANCELLED']) assert.notEqual(registrationSummary({ ...mission, status }).tone, 'success');
});
test('notices do not display mission availability', () => {
  assert.equal(registrationSummary({ kind: 'NOTICE' }).label, 'Aviso da comunidade');
});
test('search handles accents, multiple words, GM, creator and missing optional text', () => {
  const row = { title: 'Ruínas da Aurora', gm_name: 'Érico', creator_name: 'Luísa' };
  assert.equal(matchesMissionSearch(row, 'ruinas erico'), true);
  assert.equal(matchesMissionSearch(row, '  luisa  '), true);
  assert.equal(matchesMissionSearch(row, 'deserto'), false);
  assert.equal(matchesMissionSearch({}, ''), true);
});
