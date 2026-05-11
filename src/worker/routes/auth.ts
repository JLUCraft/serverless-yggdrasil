import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as userService from '../services/user';
import * as muaService from '../services/mua';
import * as emailService from '../services/email';
import { readJwtSecret } from '../services/security';
import siteConfig from '../../../site.config.json';
import { verifyPassword, signJWT, generateUUID, ed25519Verify, validateEd25519KeyPair } from '../utils/crypto';
import { success, error } from '../utils/response';
import { getClientIP } from '../utils/request';
import { logAuthEvent } from '../services/auth-log';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
async function createToken(secret: string, user: { uuid: string; id: number; role: string }) {
  return signJWT(
    {
      sub: user.uuid,
      uid: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 604800,
      jti: generateUUID(),
    },
    secret
  );
}

function validateUsername(username: string): Response | null {
  if (username.length < 3 || username.length > 16) {
    return error('Username must be 3-16 characters', 400);
  }
  return null;
}

function validateCredentials(username: string, password: string): Response | null {
  const invalidUsername = validateUsername(username);
  if (invalidUsername) return invalidUsername;
  if (password.length < 8) {
    return error('Password must be at least 8 characters', 400);
  }
  return null;
}

function normalizeEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return null;
  }
}

async function findTrustedMUAEndpoint(db: Env['DB'], authServerUrl: string): Promise<muaService.MUATrustedSite | null> {
  const requestedEndpoint = normalizeEndpoint(authServerUrl);
  if (!requestedEndpoint) return null;

  const trustedSites = await muaService.getAllTrustedSites(db);
  return trustedSites.find((site) => normalizeEndpoint(site.endpoint) === requestedEndpoint) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSelectedProfile(value: unknown): { id: string; name: string } | null {
  if (!isRecord(value) || !isRecord(value.selectedProfile)) return null;
  const { id, name } = value.selectedProfile;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return { id, name };
}

async function verifyPeerIdOwnership(
  peerId: string,
  publicKeyBase64: string,
  signatureBase64: string,
  uuid: string
): Promise<Response | null> {
  let keyPair: { publicKey: Uint8Array; signature: Uint8Array };
  try {
    keyPair = validateEd25519KeyPair(publicKeyBase64, signatureBase64);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid key or signature encoding';
    return error(message, 400);
  }

  const message = new TextEncoder().encode(`bind-peer:${uuid}:${peerId}`);
  const valid = await ed25519Verify(message, keyPair.signature, keyPair.publicKey);
  if (!valid) {
    return error('Invalid signature — peer_id ownership not proven', 403);
  }
  return null;
}

// Step 1: Initiate registration — create verification request
app.post('/register/initiate', async (c) => {
  const body = await c.req.json<{ username: string; email: string }>();
  if (!body.username || !body.email) {
    return error('Username and email are required', 400);
  }
  const invalidUsername = validateUsername(body.username);
  if (invalidUsername) return invalidUsername;

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

  const secret = readJwtSecret(c.env);
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

  const domain = emailService.getEmailDomain(email);
  if (!domain) {
    return error('Verification token does not match a valid email', 400);
  }

  const existingUser = await userService.getUserByUsername(db, body.username);
  const existingEmail = await userService.getUserByEmail(db, email);

  if (existingUser || existingEmail) {
    if (!existingUser || !existingEmail || existingUser.id !== existingEmail.id || existingUser.email !== email) {
      if (existingUser) return error('Username already taken', 409);
      return error('Email already registered', 409);
    }

    if (!existingUser.password_hash || !(await verifyPassword(body.password, existingUser.password_hash))) {
      return error('Username already taken', 409);
    }

    const profile = await userService.getProfileByName(db, body.username);
    if (!profile) {
      await userService.createPlayerProfile(db, existingUser.id, body.username);
    } else if (profile.user_uuid !== existingUser.uuid) {
      return error('Profile name already taken', 409);
    }

    await userService.updateUser(db, existingUser.id, {
      email_verified: 1,
      email_domain: domain,
    });
    await emailService.markEmailVerified(db, verification.id, existingUser.id);

    const token = await createToken(secret, { uuid: existingUser.uuid, id: existingUser.id, role: existingUser.role });
    return success({
      token,
      user: {
        uuid: existingUser.uuid,
        username: existingUser.username,
        role: existingUser.role,
        email_verified: true,
      },
    });
  }

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

  await emailService.markEmailVerified(db, verification.id, user.id);

  const token = await createToken(secret, { uuid: user.uuid, id: user.id, role: user.role });

  await logAuthEvent(db, { event_type: 'register', user_id: user.id, username: user.username, ip_address: getClientIP(c), user_agent: c.req.header('User-Agent') ?? undefined });

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
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;

  if (!body.username || !body.password) {
    await logAuthEvent(c.env.DB, { event_type: 'login_failure', username: body.username, ip_address: ip, user_agent: userAgent, details: 'Missing credentials' });
    return error('Username and password are required', 400);
  }

  const db = c.env.DB;
  const user = await userService.getUserByUsername(db, body.username);
  if (!user || !user.password_hash) {
    await logAuthEvent(c.env.DB, { event_type: 'login_failure', username: body.username, ip_address: ip, user_agent: userAgent, details: 'User not found' });
    return error('Invalid credentials', 401);
  }

  if (user.status !== 'active') {
    await logAuthEvent(c.env.DB, { event_type: 'login_failure', user_id: user.id, username: user.username, ip_address: ip, user_agent: userAgent, details: `Account status: ${user.status}` });
    return error('Account is suspended or banned', 403);
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    await logAuthEvent(c.env.DB, { event_type: 'login_failure', user_id: user.id, username: user.username, ip_address: ip, user_agent: userAgent, details: 'Invalid password' });
    return error('Invalid credentials', 401);
  }

  const secret = readJwtSecret(c.env);

  await userService.updateUser(db, user.id, {
    last_login_at: Math.floor(Date.now() / 1000),
  });

  const token = await createToken(secret, user);

  await logAuthEvent(c.env.DB, { event_type: 'login_success', user_id: user.id, username: user.username, ip_address: ip, user_agent: userAgent });

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
  const body = await c.req.json<{
    username?: string;
    peer_id?: string | null;
    peer_id_public_key?: string;
    peer_id_signature?: string;
  }>();

  const db = c.env.DB;
  const user = await userService.getUserById(db, jwt.uid);
  if (!user) {
    return error('User not found', 404);
  }
  const updates: Parameters<typeof userService.updateUser>[2] = {};

  if (body.username !== undefined) {
    updates.username = body.username;
  }

  if (body.peer_id !== undefined) {
    if (body.peer_id === null || body.peer_id === '') {
      updates.peer_id = null;
    } else {
      if (!body.peer_id_public_key || !body.peer_id_signature) {
        return error('peer_id_public_key and peer_id_signature are required when setting peer_id', 400);
      }

      const verifyErr = await verifyPeerIdOwnership(body.peer_id, body.peer_id_public_key, body.peer_id_signature, user.uuid);
      if (verifyErr) return verifyErr;

      const existing = await userService.getUserByPeerId(db, body.peer_id);
      if (existing && existing.id !== user.id) {
        return error('peer_id is already bound to another account', 409);
      }

      updates.peer_id = body.peer_id;
    }
  }

  await userService.updateUser(db, jwt.uid, updates);
  return success({ updated: true });
});

// MUA PeerID binding — allows FollyLauncher to bind peer_id using MUA OAuth token
app.post('/mua-peer-bind', async (c) => {
  const body = await c.req.json<{
    mua_access_token: string;
    auth_server_url: string;
    peer_id: string;
    peer_id_public_key: string;
    peer_id_signature: string;
  }>();

  if (!body.mua_access_token || !body.auth_server_url || !body.peer_id || !body.peer_id_public_key || !body.peer_id_signature) {
    return error('mua_access_token, auth_server_url, peer_id, peer_id_public_key, and peer_id_signature are required', 400);
  }

  const db = c.env.DB;
  const trustedSite = await findTrustedMUAEndpoint(db, body.auth_server_url);
  if (!trustedSite) {
    return error('auth_server_url is not a trusted MUA site', 403);
  }

  let muaUUID: string;
  let muaUsername: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: body.mua_access_token }),
      signal: controller.signal,
    };
    const endpoint = normalizeEndpoint(trustedSite.endpoint);
    if (!endpoint) {
      clearTimeout(timeout);
      return error('Trusted MUA site endpoint is invalid', 500);
    }
    const resp = await fetch(`${endpoint}/authserver/refresh`, init);
    clearTimeout(timeout);
    if (!resp.ok) {
      return error('Invalid MUA access token', 401);
    }
    const selectedProfile = readSelectedProfile(await resp.json());
    if (!selectedProfile) {
      return error('No selected profile in MUA token response', 401);
    }
    muaUUID = selectedProfile.id;
    muaUsername = selectedProfile.name;
  } catch {
    return error('Failed to verify MUA access token', 502);
  }

  const verifyErr = await verifyPeerIdOwnership(body.peer_id, body.peer_id_public_key, body.peer_id_signature, muaUUID);
  if (verifyErr) return verifyErr;

  const [existingPeerUser, muaUser] = await Promise.all([
    userService.getUserByPeerId(db, body.peer_id),
    userService.getUserByMUABinding(db, muaUUID),
  ]);

  let user = muaUser;
  if (!user) {
    user = await userService.createUser(db, {
      username: muaUsername,
      email: null,
    });
    await userService.createPlayerProfile(db, user.id, muaUsername);
    await userService.createMUABinding(db, user.id, muaUUID, trustedSite.site_code, muaUUID);
  }

  if (existingPeerUser && existingPeerUser.id !== user.id) {
    return error('peer_id is already bound to another account', 409);
  }

  await userService.updateUser(db, user.id, { peer_id: body.peer_id });

  const secret = readJwtSecret(c.env);
  const token = await createToken(secret, { uuid: user.uuid, id: user.id, role: user.role });

  return success({
    token,
    user: {
      uuid: user.uuid,
      username: user.username,
      role: user.role,
      peer_id: body.peer_id,
    },
  });
});

// Admin: Update user role (moved to /api/admin/users/:uuid/role — admin.ts)
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
