import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { getUserById } from '../services/user';
import { verifyJWT } from '../utils/crypto';
import { error } from '../utils/response';
import { logAuthEvent } from '../services/auth-log';

function getClientIP(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
}

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

// Yggdrasil accessToken 验证（用于游戏客户端）
export async function verifyAccessToken(
  c: Context<{ Bindings: Env }>,
  accessToken: string
): Promise<{ uuid: string; name: string; userId: number } | null> {
  const cacheKey = `token:${accessToken}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as { uuid: string; name: string; userId: number };
  }
  return null;
}

export async function storeAccessToken(
  c: Context<{ Bindings: Env }>,
  accessToken: string,
  data: { uuid: string; name: string; userId: number },
  ttlSeconds: number = 86400
): Promise<void> {
  const cacheKey = `token:${accessToken}`;
  await c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: ttlSeconds });
  // Also index by user for bulk invalidation
  const userIndexKey = `user_tokens:${data.userId}`;
  const existing = await c.env.KV.get(userIndexKey);
  const tokens = existing ? (JSON.parse(existing) as string[]) : [];
  if (!tokens.includes(accessToken)) {
    tokens.push(accessToken);
    await c.env.KV.put(userIndexKey, JSON.stringify(tokens), { expirationTtl: ttlSeconds });
  }
}

export async function invalidateAccessToken(
  c: Context<{ Bindings: Env }>,
  accessToken: string
): Promise<void> {
  const cacheKey = `token:${accessToken}`;
  await c.env.KV.delete(cacheKey);
}

export async function invalidateAllUserTokens(
  c: Context<{ Bindings: Env }>,
  userId: number
): Promise<void> {
  const userIndexKey = `user_tokens:${userId}`;
  const existing = await c.env.KV.get(userIndexKey);
  if (existing) {
    const tokens = JSON.parse(existing) as string[];
    for (const token of tokens) {
      await c.env.KV.delete(`token:${token}`);
    }
    await c.env.KV.delete(userIndexKey);
  }
}
