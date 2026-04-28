import { Hono } from 'hono';
import type { Env } from '../types';
import {
  authenticate,
  refresh,
  getProfileWithTextures,
  getProfileWithTexturesByName,
  validateToken,
} from '../services/yggdrasil';
import {
  storeAccessToken,
  invalidateAccessToken,
  verifyAccessToken,
  invalidateAllUserTokens,
} from '../middleware/auth';
import { getUserByUsername, getProfileByName } from '../services/user';
import { readJwtSecret } from '../services/security';
import { verifyPassword } from '../utils/crypto';
import { yggdrasilError, json, error } from '../utils/response';
import siteConfig from '../../../site.config.json';
import { getTextureSignPublicKey } from '../services/union';
import { logAuthEvent } from '../services/auth-log';

const app = new Hono<{ Bindings: Env }>();

function getClientIP(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
}

function getBaseUrl(c: import('hono').Context<{ Bindings: Env }>): string {
  const host = c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

// Metadata endpoint
app.get('/', async (c) => {
  const baseUrl = getBaseUrl(c);
  const publicKey = await getTextureSignPublicKey(c.env.DB);
  return json({
    meta: {
      serverName: c.env.APP_NAME,
      implementationName: 'serverless-yggdrasil',
      implementationVersion: '1.0.0',
      links: {
        homepage: baseUrl,
        register: `${baseUrl}/api/auth/register`,
      },
      feature: {
        enableProfileKey: true,
        nonEmailLogin: true,
      },
    },
    skinDomains: siteConfig.allowedEmailDomains,
    signaturePublickey: publicKey ?? '',
  });
});

// Authserver: Authenticate
app.post('/authserver/authenticate', async (c) => {
  const body = await c.req.json();
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  const result = await authenticate(c.env.DB, body, readJwtSecret(c.env));
  if (!result) {
    await logAuthEvent(c.env.DB, { event_type: 'login_failure', username: body.username, ip_address: ip, user_agent: userAgent, details: 'Yggdrasil authenticate failed' });
    return yggdrasilError('ForbiddenOperationException', 'Invalid credentials. Invalid username or password.');
  }

  // Store token in KV for quick lookup
  await storeAccessToken(c, result.accessToken, {
    uuid: result.selectedProfile?.id ?? '',
    name: result.selectedProfile?.name ?? '',
    userId: 0, // Will be resolved on validate
  });

  await logAuthEvent(c.env.DB, { event_type: 'login_success', username: body.username, ip_address: ip, user_agent: userAgent, details: 'Yggdrasil authenticate' });
  return json(result);
});

// Authserver: Refresh
app.post('/authserver/refresh', async (c) => {
  const body = await c.req.json();
  const result = await refresh(c.env.DB, body, readJwtSecret(c.env));
  if (!result) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid token.');
  }
  return json(result);
});

// Authserver: Validate
app.post('/authserver/validate', async (c) => {
  const body = await c.req.json<{ accessToken: string; clientToken?: string }>();
  if (!body.accessToken) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid token.');
  }

  // Validate JWT signature and optionally clientToken
  const payload = await validateToken(body.accessToken, body.clientToken, readJwtSecret(c.env));
  if (!payload) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid token.');
  }

  // Also check KV cache
  const cached = await verifyAccessToken(c, body.accessToken);
  if (!cached) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid token.');
  }

  return new Response(null, { status: 204 });
});

// Authserver: Invalidate
app.post('/authserver/invalidate', async (c) => {
  const body = await c.req.json<{ accessToken: string }>();
  if (body.accessToken) {
    await invalidateAccessToken(c, body.accessToken);
  }
  return new Response(null, { status: 204 });
});

// Authserver: Signout — invalidate ALL sessions for the user
app.post('/authserver/signout', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;

  if (!body.username || !body.password) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid credentials.');
  }

  const db = c.env.DB;
  const user = await getUserByUsername(db, body.username);
  if (!user || !user.password_hash) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid credentials.');
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid credentials.');
  }

  // Invalidate all tokens for this user
  await invalidateAllUserTokens(c, user.id);

  await logAuthEvent(c.env.DB, { event_type: 'logout', user_id: user.id, username: user.username, ip_address: ip, user_agent: userAgent, details: 'Yggdrasil signout' });

  return new Response(null, { status: 204 });
});

// Sessionserver: Join
app.post('/sessionserver/session/minecraft/join', async (c) => {
  const body = await c.req.json<{
    accessToken: string;
    selectedProfile: string;
    serverId: string;
  }>();

  if (!body.accessToken || !body.selectedProfile || !body.serverId) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid request.');
  }

  // Validate token and ensure selectedProfile matches
  const cached = await verifyAccessToken(c, body.accessToken);
  if (!cached) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid token.');
  }
  if (cached.uuid !== body.selectedProfile) {
    return yggdrasilError('ForbiddenOperationException', 'Selected profile does not match the access token.');
  }

  // Store join request for hasJoined check
  const joinKey = `join:${body.serverId}`;
  await c.env.KV.put(
    joinKey,
    JSON.stringify({
      uuid: body.selectedProfile,
      name: cached.name,
      ip: c.req.header('CF-Connecting-IP') ?? 'unknown',
      timestamp: Date.now(),
    }),
    { expirationTtl: 60 }
  );

  return new Response(null, { status: 204 });
});

// Sessionserver: HasJoined
app.get('/sessionserver/session/minecraft/hasJoined', async (c) => {
  const username = c.req.query('username');
  const serverId = c.req.query('serverId');
  const ip = c.req.query('ip');

  if (!username || !serverId) {
    return yggdrasilError('ForbiddenOperationException', 'Invalid request.');
  }

  const joinKey = `join:${serverId}`;
  const joinData = await c.env.KV.get(joinKey);
  if (!joinData) {
    return new Response(null, { status: 204 });
  }

  const join = JSON.parse(joinData) as { uuid: string; name: string; ip: string };

  // Optional IP check
  if (ip && join.ip !== ip) {
    return new Response(null, { status: 204 });
  }

  // Consume the join record (delete it after successful lookup)
  await c.env.KV.delete(joinKey);

  const baseUrl = getBaseUrl(c);
  // hasJoined must return signed textures (unsigned=false) per Yggdrasil protocol
  const profile = await getProfileWithTextures(c.env.DB, join.uuid, false, baseUrl);
  if (!profile) {
    return new Response(null, { status: 204 });
  }

  return json(profile);
});

// Sessionserver: Profile
app.get('/sessionserver/session/minecraft/profile/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return new Response(null, { status: 204 });
  }
  const unsigned = c.req.query('unsigned') !== 'false';
  const baseUrl = getBaseUrl(c);

  const profile = await getProfileWithTextures(c.env.DB, uuid, unsigned, baseUrl);
  if (!profile) {
    return new Response(null, { status: 204 });
  }

  return json(profile);
});

// API: Player profiles by names
app.post('/api/profiles/minecraft', async (c) => {
  const names = await c.req.json<string[]>();
  if (!Array.isArray(names) || names.length === 0 || names.length > 10) {
    return error('Invalid request: expected 1-10 names', 400);
  }

  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);
  const results = [];

  for (const name of names) {
    const profile = await getProfileWithTexturesByName(db, name, true, baseUrl);
    if (profile) {
      results.push({ id: profile.id, name: profile.name });
    }
  }

  return json(results);
});

// API: Profile by name (non-standard, returns properties for frontend use)
app.get('/api/profiles/minecraft/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return error('Profile not found', 404);
  }
  const baseUrl = getBaseUrl(c);

  const profile = await getProfileWithTexturesByName(c.env.DB, name, true, baseUrl);
  if (!profile) {
    return error('Profile not found', 404);
  }

  return json({ id: profile.id, name: profile.name, properties: profile.properties });
});

// Standard Yggdrasil API: Profile by name (returns {id, name} or 204)
app.get('/api/users/profiles/minecraft/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return new Response(null, { status: 204 });
  }

  const profile = await getProfileByName(c.env.DB, name);
  if (!profile) {
    return new Response(null, { status: 204 });
  }

  return json({ id: profile.uuid.replace(/-/g, ''), name: profile.name });
});

// Standard Yggdrasil API: Profile by name (Microsoft services route)
app.get('/minecraftservices/minecraft/profile/lookup/name/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return new Response(null, { status: 204 });
  }

  const profile = await getProfileByName(c.env.DB, name);
  if (!profile) {
    return new Response(null, { status: 204 });
  }

  return json({ id: profile.uuid.replace(/-/g, ''), name: profile.name });
});

export default app;
