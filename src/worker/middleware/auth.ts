import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { getUserById, getPlayerProfiles } from '../services/user';
import { verifyJWT } from '../utils/crypto';
import { error } from '../utils/response';
import { getClientIP } from '../utils/request';
import { logAuthEvent } from '../services/auth-log';
import { readJwtSecret } from '../services/security';

export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const header = c.req.header('Authorization');
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;

  if (!header || !header.startsWith('Bearer ')) {
    await logAuthEvent(c.env.DB, { event_type: 'token_invalid', ip_address: ip, user_agent: userAgent, details: 'Missing or invalid Authorization header' });
    return error('Missing or invalid Authorization header', 401);
  }

  const token = header.slice(7);
  const payload = await verifyJWT<import('../types').JWTPayload>(token, c.env.JWT_SECRET);

  if (!payload) {
    await logAuthEvent(c.env.DB, { event_type: 'token_invalid', ip_address: ip, user_agent: userAgent, details: 'JWT verification failed' });
    return error('Invalid or expired token', 401);
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    await logAuthEvent(c.env.DB, { event_type: 'token_expired', user_id: payload.uid, ip_address: ip, user_agent: userAgent, details: 'JWT expired' });
    return error('Invalid or expired token', 401);
  }

  const user = await getUserById(c.env.DB, payload.uid);
  if (!user || user.uuid !== payload.sub) {
    await logAuthEvent(c.env.DB, { event_type: 'token_invalid', user_id: payload.uid, ip_address: ip, user_agent: userAgent, details: 'User not found or UUID mismatch' });
    return error('Invalid or expired token', 401);
  }
  if (user.status !== 'active') {
    await logAuthEvent(c.env.DB, { event_type: 'token_invalid', user_id: user.id, username: user.username, ip_address: ip, user_agent: userAgent, details: `Account status: ${user.status}` });
    return error('Account is suspended or banned', 403);
  }

  payload.role = user.role;
  c.set('user', payload);
  await next();
  return undefined;
};






function extractJwtExpiration(accessToken: string): number | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  const bodySegment = parts[1];
  if (!bodySegment) return null;
  try {
    const decoded = atob(bodySegment);
    const payload = parseJsonObject(decoded);
    if (payload !== null && typeof payload.exp === 'number') {
      return payload.exp;
    }
    return null;
  } catch {
    return null;
  }
}


function computeRevokedTtlFromJwt(accessToken: string): number {
  const exp = extractJwtExpiration(accessToken);
  if (exp !== null) {
    const now = Math.floor(Date.now() / 1000);
    const remainingLifetime = exp - now;
    if (remainingLifetime > 0) {
      return Math.max(remainingLifetime, 1);
    }
  }
  return 86400;
}


function makeRevokedKey(accessToken: string): string {
  return `revoked_token:${accessToken}`;
}



function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const obj: unknown = JSON.parse(value);
    return isRecord(obj) ? obj : null;
  } catch {
    return null;
  }
}


function parseCachedTokenData(
  value: string,
): { uuid: string; name: string; userId: number } | null {
  try {
    const obj: unknown = JSON.parse(value);
    if (!isRecord(obj)) return null;
    if (
      typeof obj.uuid === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.userId === 'number' &&
      Number.isFinite(obj.userId)
    ) {
      return { uuid: obj.uuid, name: obj.name, userId: obj.userId };
    }
    return null;
  } catch {
    return null;
  }
}


function parseTokenList(value: string): string[] {
  try {
    const arr: unknown = JSON.parse(value);
    if (!Array.isArray(arr)) return [];
    return arr.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}






export async function verifyAccessToken(
  c: Context<{ Bindings: Env }>,
  accessToken: string
): Promise<{ uuid: string; name: string; userId: number } | null> {



  const revokedKey = makeRevokedKey(accessToken);
  const revoked = await c.env.KV.get(revokedKey);
  if (revoked !== null) return null;


  const cacheKey = `token:${accessToken}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) {
    const cachedData = parseCachedTokenData(cached);
    if (cachedData !== null) return cachedData;

  }


  let secret: string;
  try {
    secret = readJwtSecret(c.env);
  } catch {
    return null;
  }

  const payload = await verifyJWT<{ sub: string; uid: number; exp: number; iat: number }>(
    accessToken,
    secret,
  );
  if (!payload) return null;


  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;


  const user = await getUserById(c.env.DB, payload.uid);
  if (!user || user.uuid !== payload.sub) return null;
  if (user.status !== 'active') return null;


  const profiles = await getPlayerProfiles(c.env.DB, user.id);
  const name = profiles[0]?.name ?? user.username;

  const result = { uuid: user.uuid, name, userId: user.id };




  const remainingTtl = Math.max(payload.exp - now, 60);
  await storeAccessToken(c, accessToken, result, remainingTtl);

  return result;
}

export async function storeAccessToken(
  c: Context<{ Bindings: Env }>,
  accessToken: string,
  data: { uuid: string; name: string; userId: number },
  ttlSeconds: number = 86400
): Promise<void> {

  const revokedKey = makeRevokedKey(accessToken);
  const revoked = await c.env.KV.get(revokedKey);
  if (revoked !== null) return;

  const cacheKey = `token:${accessToken}`;
  await c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: ttlSeconds });

  const userIndexKey = `user_tokens:${data.userId}`;
  const existing = await c.env.KV.get(userIndexKey);
  const tokens = existing ? parseTokenList(existing) : [];
  if (!tokens.includes(accessToken)) {
    tokens.push(accessToken);
    await c.env.KV.put(userIndexKey, JSON.stringify(tokens), { expirationTtl: ttlSeconds });
  }
}

export async function invalidateAccessToken(
  c: Context<{ Bindings: Env }>,
  accessToken: string
): Promise<void> {


  const revokedKey = makeRevokedKey(accessToken);
  const revocationTtl = computeRevokedTtlFromJwt(accessToken);
  await c.env.KV.put(revokedKey, '1', { expirationTtl: revocationTtl });


  const cacheKey = `token:${accessToken}`;


  const cached = await c.env.KV.get(cacheKey);
  if (cached) {
    const data = parseCachedTokenData(cached);
    if (data !== null) {
      const userIndexKey = `user_tokens:${data.userId}`;
      const existing = await c.env.KV.get(userIndexKey);
      if (existing) {
        const tokens = parseTokenList(existing).filter(t => t !== accessToken);
        if (tokens.length > 0) {
          await c.env.KV.put(userIndexKey, JSON.stringify(tokens), { expirationTtl: 86400 });
        } else {
          await c.env.KV.delete(userIndexKey);
        }
      }
    }
  }
  await c.env.KV.delete(cacheKey);
}

export async function invalidateAllUserTokens(
  c: Context<{ Bindings: Env }>,
  userId: number
): Promise<void> {
  const userIndexKey = `user_tokens:${userId}`;
  const existing = await c.env.KV.get(userIndexKey);
  if (!existing) return;

  const tokens = parseTokenList(existing);
  for (const token of tokens) {


    await invalidateAccessToken(c, token);
  }


  await c.env.KV.delete(userIndexKey);
}
