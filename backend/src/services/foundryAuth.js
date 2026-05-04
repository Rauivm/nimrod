import jwt from 'jsonwebtoken';

/**
 * Sign a short-lived JWT containing Foundry launch context.
 * Default algorithm: HS256.
 *
 * @param {object} payload  – { e, r, w, a, exp }
 * @param {string} secret
 * @returns {string} signed JWT
 */
export function signFoundryToken(payload, secret) {
  return jwt.sign(payload, secret);
}

/**
 * Verify and decode a Foundry JWT.
 * Throws if the token is expired, tampered, or otherwise invalid.
 *
 * @param {string} token
 * @param {string} secret
 * @returns {object} decoded payload
 */
export function verifyFoundryToken(token, secret) {
  return jwt.verify(token, secret);
}
