import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { transaction, query } from '../db/index.js';
import { fail, requireUuid } from './missionRules.js';
import { isGM } from '../lib/roles.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const jwtSecret = () => process.env.FOUNDRY_JWT_SECRET || fail(503, 'Segredo JWT Foundry não configurado.');
export async function createIdentityProof(body) {
  if (typeof body.worldId !== 'string' || !body.worldId.trim() || typeof body.foundryUserId !== 'string' || !body.foundryUserId.trim()) fail(400, 'Informe os IDs do mundo e da conta Foundry.');
  const secret = randomBytes(32).toString('hex');
  const proof = (await query('INSERT INTO foundry_identity_proofs(secret_hash,world_id,foundry_user_id,requested_gm) VALUES($1,$2,$3,$4) RETURNING id,expires_at', [hash(secret), body.worldId, body.foundryUserId, body.isGM === true])).rows[0];
  return {
    proofId: proof.id,
    secret,
    expiresAt: proof.expires_at
  };
}
export async function approveIdentityProof(id, user) {
  requireUuid(id);
  return transaction(async client => {
    const proof = (await client.query('SELECT * FROM foundry_identity_proofs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!proof || proof.consumed_at || new Date(proof.expires_at) <= new Date()) fail(410, 'Associação expirada ou já utilizada.');
    if (proof.approved_user_id && proof.approved_user_id !== user.id) fail(409, 'Associação já aprovada por outra conta.');
    if (proof.requested_gm && !isGM(user)) fail(403, 'A conta Nimrod precisa ser GM para este vínculo de narrador.');
    await client.query('UPDATE foundry_identity_proofs SET approved_user_id=$2 WHERE id=$1', [id, user.id]);
    return {
      approved: true,
      worldId: proof.world_id,
      foundryUserId: proof.foundry_user_id
    };
  });
}
export async function redeemIdentityProof(id, secret) {
  requireUuid(id);
  if (typeof secret !== 'string' || secret.length !== 64) fail(401, 'Comprovante inválido.');
  return transaction(async client => {
    const proof = (await client.query('SELECT * FROM foundry_identity_proofs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!proof || !timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(proof.secret_hash))) fail(401, 'Comprovante inválido.');
    if (proof.consumed_at || new Date(proof.expires_at) <= new Date()) fail(410, 'Comprovante expirado ou já utilizado.');
    if (!proof.approved_user_id) return {
      pending: true
    };
    const conflicts = await client.query(`SELECT 1 FROM foundry_user_links WHERE world_id=$1 AND
      ((foundry_user_id=$2 AND user_id<>$3) OR (user_id=$3 AND foundry_user_id<>$2))`, [proof.world_id, proof.foundry_user_id, proof.approved_user_id]);
    if (conflicts.rows.length) fail(409, 'Já existe outro vínculo para essa conta. Revise o vínculo autenticado no Nimrod.');
    const linked = await client.query(`INSERT INTO foundry_user_links(world_id,foundry_user_id,user_id) VALUES($1,$2,$3)
      ON CONFLICT(world_id,foundry_user_id) DO UPDATE SET user_id=foundry_user_links.user_id RETURNING user_id`, [proof.world_id, proof.foundry_user_id, proof.approved_user_id]);
    if (linked.rows[0].user_id !== proof.approved_user_id) fail(409, 'Conta Foundry já associada.');
    await client.query('UPDATE foundry_identity_proofs SET consumed_at=NOW() WHERE id=$1', [id]);
    const token = jwt.sign({
      purpose: 'foundry-client',
      sub: proof.approved_user_id,
      worldId: proof.world_id,
      foundryUserId: proof.foundry_user_id
    }, jwtSecret(), {
      expiresIn: '8h',
      algorithm: 'HS256'
    });
    return {
      token,
      worldId: proof.world_id,
      userId: proof.approved_user_id
    };
  });
}
export async function foundryClient(request) {
  let payload;
  try {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    payload = jwt.verify(token, jwtSecret(), {
      algorithms: ['HS256']
    });
  } catch {
    fail(401, 'Autentique sua conta Nimrod no painel Foundry.');
  }
  if (payload.purpose !== 'foundry-client') fail(401, 'Token não destinado ao cliente Foundry.');
  const user = (await query(`SELECT u.* FROM foundry_user_links l JOIN users u ON u.id=l.user_id
    WHERE l.world_id=$1 AND l.foundry_user_id=$2 AND l.user_id=$3`, [payload.worldId, payload.foundryUserId, payload.sub])).rows[0];
  if (!user) fail(401, 'Vínculo revogado.');
  return {
    user,
    worldId: payload.worldId,
    foundryUserId: payload.foundryUserId
  };
}
