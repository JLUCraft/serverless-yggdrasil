import type { MiddlewareHandler } from 'hono';
import type { Env, UserRole, Variables } from '../types';
import { error } from '../utils/response';

const roleHierarchy: Record<UserRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
};

export function requireRole(minRole: UserRole): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return error('Authentication required', 401);
    }

    if (roleHierarchy[user.role] < roleHierarchy[minRole]) {
      return error(`This action requires ${minRole} role or higher`, 403);
    }

    await next();
    return undefined;
  };
}

export function requireAnyRole(...roles: UserRole[]): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return error('Authentication required', 401);
    }

    if (!roles.includes(user.role)) {
      return error(`This action requires one of: ${roles.join(', ')}`, 403);
    }

    await next();
    return undefined;
  };
}
