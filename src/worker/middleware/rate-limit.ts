import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { error } from '../utils/response';
import { getClientIP } from '../utils/request';

interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
  keyPrefix?: string;
}

function makeKey(ip: string, prefix: string, windowStart: number): string {
  return `${prefix}:${ip}:${windowStart}`;
}

export function rateLimit(config: RateLimitConfig): MiddlewareHandler<{ Bindings: Env }> {
  const { windowSeconds, maxRequests, keyPrefix = 'rate_limit' } = config;

  return async (c, next) => {
    const ip = getClientIP(c);
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
    const key = makeKey(ip, keyPrefix, windowStart);

    const current = await c.env.KV.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= maxRequests) {
      return error('Rate limit exceeded', 429);
    }

    await c.env.KV.put(key, String(count + 1), { expirationTtl: windowSeconds + 1 });
    await next();
    return undefined;
  };
}


export const strictRateLimit = rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'rate_limit_strict' });
export const standardRateLimit = rateLimit({ windowSeconds: 60, maxRequests: 60, keyPrefix: 'rate_limit' });
