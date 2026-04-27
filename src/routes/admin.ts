import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as userService from '../services/user';
import { success, error } from '../utils/response';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// List all users (admin only)
app.get('/users', authMiddleware, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const { results } = await db
    .prepare('SELECT id, uuid, email, email_verified, username, role, status, club, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all<{
      id: number;
      uuid: string;
      email: string | null;
      email_verified: number;
      username: string;
      role: string;
      status: string;
      club: string | null;
      created_at: number;
    }>();

  return success(results ?? []);
});

// Get user detail (admin only)
app.get('/users/:uuid', authMiddleware, requireRole('admin'), async (c) => {
  const uuid = c.req.param('uuid');
  const db = c.env.DB;

  const user = await userService.getUserByUUID(db, uuid);
  if (!user) {
    return error('User not found', 404);
  }

  const profiles = await userService.getPlayerProfiles(db, user.id);

  return success({
    uuid: user.uuid,
    username: user.username,
    email: user.email,
    email_verified: user.email_verified === 1,
    role: user.role,
    status: user.status,
    club: user.club,
    created_at: user.created_at,
    profiles: profiles.map((p) => ({
      uuid: p.uuid,
      name: p.name,
      model: p.model,
    })),
  });
});

// Update user role/status (admin only)
app.patch('/users/:uuid', authMiddleware, requireRole('admin'), async (c) => {
  const uuid = c.req.param('uuid');
  const body = await c.req.json<{
    role?: 'guest' | 'member' | 'admin';
    status?: 'active' | 'suspended' | 'banned';
    club?: string | null;
  }>();

  const db = c.env.DB;
  const user = await userService.getUserByUUID(db, uuid);
  if (!user) {
    return error('User not found', 404);
  }

  const updates: Parameters<typeof userService.updateUser>[2] = {};
  if (body.role !== undefined) updates.role = body.role;
  if (body.status !== undefined) updates.status = body.status;
  if (body.club !== undefined) updates.club = body.club;

  await userService.updateUser(db, user.id, updates);

  return success({ updated: true });
});

export default app;
