import type { Env } from '../types';

export class ConfigurationError extends Error {}

export function readJwtSecret(env: Pick<Env, 'JWT_SECRET'>): string {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) {
    throw new ConfigurationError('JWT_SECRET must be configured');
  }
  return secret;
}
