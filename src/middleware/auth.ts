import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { verifyJWT } from '../utils/crypto';
import { error } from '../utils/response';

export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return error('Missing or invalid Authorization header', 401);
  }

  const token = header.slice(7);
  const payload = await verifyJWT<import('../types').JWTPayload>(token, c.env.JWT_SECRET);

  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return error('Invalid or expired token', 401);
  }

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
