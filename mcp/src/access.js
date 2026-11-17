import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cloudflare manages OAuth discovery, client registration and user login at the edge.
// Verify its assertion at the origin too, including the specific application's audience.
export function createAccessVerifier({ issuer, audience, jwks } = {}) {
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) {
    throw new Error('CF_ACCESS_TEAM_DOMAIN must be an HTTPS Cloudflare Access team origin.');
  }
  if (!audience?.trim()) throw new Error('CF_ACCESS_AUD is required.');
  const keys = jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async assertion => {
    if (typeof assertion !== 'string' || !assertion) throw new Error('Missing Access assertion.');
    return jwtVerify(assertion, keys, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'sub']
    });
  };
}
