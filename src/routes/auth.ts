import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as userService from '../services/user';
import * as emailService from '../services/email';
import { siteConfig } from '../config';
import { verifyPassword, signJWT, generateUUID } from '../utils/crypto';
import { success, error } from '../utils/response';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function createToken(c: { env: Env }, user: { uuid: string; id: number; role: string }) {
  return signJWT(
    {
      sub: user.uuid,
      uid: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 604800,
      jti: generateUUID(),
    },
    c.env.JWT_SECRET
  );
}

function validateCredentials(username: string, password: string): Response | null {
  if (username.length < 3 || username.length > 16) {
    return error('Username must be 3-16 characters', 400);
  }
  if (password.length < 8) {
    return error('Password must be at least 8 characters', 400);
  }
  return null;
}

// Step 1: Initiate registration — create verification request
app.post('/register/initiate', async (c) => {
  const body = await c.req.json<{ username: string; password: string; email: string }>();
  if (!body.username || !body.password || !body.email) {
    return error('Username, password and email are required', 400);
  }
  const invalidCredentials = validateCredentials(body.username, body.password);
  if (invalidCredentials) return invalidCredentials;

  const email = emailService.normalizeEmail(body.email);
  const policy = emailService.readPolicy(c.env);
  const domain = emailService.getEmailDomain(email);
  if (!domain || !emailService.isAllowedDomain(email, siteConfig.allowedEmailDomains)) {
    return error(`Email domain not allowed. Allowed: ${siteConfig.allowedEmailDomains.join(', ')}`, 400);
  }

  const db = c.env.DB;

  const existingUser = await userService.getUserByUsername(db, body.username);
  if (existingUser) {
    return error('Username already taken', 409);
  }

  const existingEmail = await userService.getUserByEmail(db, email);
  if (existingEmail) {
    return error('Email already registered', 409);
  }

  const verification = await emailService.createEmailVerification(db, email, policy.tokenBytes);

  return success({
    message: `Please send an email from ${email} to ${policy.recipient} with subject containing token: ${verification.verification_token}`,
    recipient: policy.recipient,
    token: verification.verification_token,
    expires_in: policy.ttlSeconds,
  });
});

// Step 2: Complete registration after email verification
app.post('/register/complete', async (c) => {
  const body = await c.req.json<{ username: string; password: string; email: string; verification_token: string }>();
  if (!body.username || !body.password || !body.email || !body.verification_token) {
    return error('Username, password, email and verification token are required', 400);
  }
  const invalidCredentials = validateCredentials(body.username, body.password);
  if (invalidCredentials) return invalidCredentials;

  const db = c.env.DB;

  const verification = await emailService.getEmailVerificationByToken(db, body.verification_token);
  if (!verification) {
    return error('Invalid verification token', 400);
  }
  const policy = emailService.readPolicy(c.env);
  if (emailService.isExpired(verification, Math.floor(Date.now() / 1000), policy.ttlSeconds)) {
    await emailService.markEmailExpired(db, verification.id);
    return error('Verification token expired', 400);
  }

  const email = emailService.normalizeEmail(body.email);
  if (verification.status !== 'verified') {
    return error('Email not verified yet. Please send the verification email first.', 400);
  }
  if (verification.email !== email) {
    return error('Verification token does not match the provided email', 400);
  }

  const existingUser = await userService.getUserByUsername(db, body.username);
  if (existingUser) {
    return error('Username already taken', 409);
  }

  const existingEmail = await userService.getUserByEmail(db, email);
  if (existingEmail) {
    return error('Email already registered', 409);
  }

  const domain = emailService.getEmailDomain(email);

  const user = await userService.createUser(db, {
    username: body.username,
    password: body.password,
    email,
    role: 'guest',
  });

  await userService.updateUser(db, user.id, {
    email_verified: 1,
    email_domain: domain,
  });

  await userService.createPlayerProfile(db, user.id, body.username);

  const token = await createToken(c, { uuid: user.uuid, id: user.id, role: user.role });

  return success({
    token,
    user: {
      uuid: user.uuid,
      username: user.username,
      role: user.role,
      email_verified: true,
    },
  });
});

// Legacy registration (kept for backward compatibility)
app.post('/register', async () => {
  return error('Use /api/auth/register/initiate and /api/auth/register/complete', 410);
});

// Login
app.post('/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  if (!body.username || !body.password) {
    return error('Username and password are required', 400);
  }

  const db = c.env.DB;
  const user = await userService.getUserByUsername(db, body.username);
  if (!user || !user.password_hash) {
    return error('Invalid credentials', 401);
  }

  if (user.status !== 'active') {
    return error('Account is suspended or banned', 403);
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    return error('Invalid credentials', 401);
  }

  await userService.updateUser(db, user.id, {
    last_login_at: Math.floor(Date.now() / 1000),
  });

  const token = await signJWT(
    {
      sub: user.uuid,
      uid: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 604800,
      jti: generateUUID(),
    },
    c.env.JWT_SECRET
  );

  return success({
    token,
    user: {
      uuid: user.uuid,
      username: user.username,
      role: user.role,
      email_verified: user.email_verified === 1,
      email_domain: user.email_domain,
    },
  });
});

// Request email verification (send email to specified address)
app.post('/verify-email/request', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ email: string }>();

  if (!body.email) {
    return error('Email is required', 400);
  }

  const email = emailService.normalizeEmail(body.email);
  const policy = emailService.readPolicy(c.env);
  const domain = emailService.getEmailDomain(email);
  if (!domain || !emailService.isAllowedDomain(email, siteConfig.allowedEmailDomains)) {
    return error(`Email domain not allowed. Allowed: ${siteConfig.allowedEmailDomains.join(', ')}`, 400);
  }

  const db = c.env.DB;
  const existingEmail = await userService.getUserByEmail(db, email);
  if (existingEmail && existingEmail.id !== user.uid) {
    return error('Email already registered', 409);
  }

  const verification = await emailService.createEmailVerification(db, email, policy.tokenBytes, user.uid);

  return success({
    message: `Please send an email from ${email} to ${policy.recipient} with subject containing token: ${verification.verification_token}`,
    recipient: policy.recipient,
    token: verification.verification_token,
    expires_in: policy.ttlSeconds,
  });
});

// Get current user
app.get('/me', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const db = c.env.DB;
  const user = await userService.getUserWithProfiles(db, jwt.uid);
  if (!user) {
    return error('User not found', 404);
  }

  return success({
    uuid: user.uuid,
    username: user.username,
    email: user.email,
    email_verified: user.email_verified === 1,
    email_domain: user.email_domain,
    role: user.role,
    status: user.status,
    club: user.club,
    profiles: user.profiles.map((p) => ({
      id: p.uuid,
      name: p.name,
      model: p.model,
    })),
  });
});

// Update user info
app.patch('/me', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const body = await c.req.json<Partial<{ username: string; peer_id: string }>>();

  const db = c.env.DB;
  const updates: Parameters<typeof userService.updateUser>[2] = {};

  if (body.username !== undefined) updates.username = body.username;
  if (body.peer_id !== undefined) updates.peer_id = body.peer_id;

  await userService.updateUser(db, jwt.uid, updates);
  return success({ updated: true });
});

// Admin: List users
app.get('/users', authMiddleware, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare('SELECT id, uuid, username, email, role, status, club, created_at FROM users ORDER BY created_at DESC')
    .all<{ id: number; uuid: string; username: string; email: string | null; role: string; status: string; club: string | null; created_at: number }>();

  return success(results ?? []);
});

// Admin: Update user role
app.patch('/users/:uuid/role', authMiddleware, requireRole('admin'), async (c) => {
  const targetUUID = c.req.param('uuid');
  const body = await c.req.json<{ role: 'guest' | 'member' | 'admin' }>();

  if (!body.role) {
    return error('Role is required', 400);
  }

  const db = c.env.DB;
  const target = await userService.getUserByUUID(db, targetUUID);
  if (!target) {
    return error('User not found', 404);
  }

  await userService.updateUser(db, target.id, { role: body.role });
  return success({ updated: true });
});

export default app;
