import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import * as premiumService from '../services/premium';
import * as userService from '../services/user';
import { readJwtSecret } from '../services/security';
import { success, error } from '../utils/response';
import { getBaseUrl } from '../utils/request';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();


app.get('/bind', authMiddleware, async (c) => {
  const clientId = c.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return error('Microsoft OAuth not configured', 500);
  }

  const baseUrl = getBaseUrl(c);
  const redirectUri = `${baseUrl}/api/premium/callback`;

  const state = crypto.randomUUID();

  const jwt = c.get('user');
  await c.env.KV.put(`ms_oauth_state:${state}`, JSON.stringify({ uid: jwt.uid, redirect: baseUrl }), { expirationTtl: 300 });

  const scopes = encodeURIComponent('XboxLive.signin offline_access');
  const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}`;

  return success({ auth_url: authUrl });
});


app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorCode = c.req.query('error');
  const errorDesc = c.req.query('error_description');

  if (errorCode) {
    return error(`Microsoft OAuth error: ${errorCode} - ${errorDesc ?? 'unknown'}`, 400);
  }

  if (!code || !state) {
    return error('Missing code or state', 400);
  }


  const stateData = await c.env.KV.get(`ms_oauth_state:${state}`);
  if (!stateData) {
    return error('Invalid or expired state', 400);
  }

  const { uid } = JSON.parse(stateData) as { uid: number };
  await c.env.KV.delete(`ms_oauth_state:${state}`);

  const clientId = c.env.MICROSOFT_CLIENT_ID;
  const clientSecret = c.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return error('Microsoft OAuth not configured', 500);
  }

  const baseUrl = getBaseUrl(c);
  const redirectUri = `${baseUrl}/api/premium/callback`;


  const profile = await premiumService.verifyMicrosoftAccount(code, clientId, clientSecret, redirectUri);
  if (!profile) {
    return error('Failed to verify Microsoft account. Make sure you own a legitimate Minecraft Java Edition copy.', 403);
  }


  const existing = await premiumService.getPremiumBindingByMinecraftUUID(c.env.DB, profile.id);
  if (existing && existing.user_id !== uid) {
    return error('This Microsoft/Minecraft account is already bound to another user', 409);
  }


  const tokens = await premiumService.exchangeMicrosoftCode(code, clientId, clientSecret, redirectUri);

  const binding = await premiumService.createPremiumBinding(c.env.DB, uid, profile, tokens ?? undefined);

  return success({
    bound: true,
    minecraft_uuid: binding.minecraft_uuid,
    minecraft_name: binding.minecraft_name,
  });
});


app.get('/status', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const binding = await premiumService.getPremiumBindingByUser(c.env.DB, jwt.uid);

  if (!binding) {
    return success({ bound: false });
  }

  return success({
    bound: true,
    minecraft_uuid: binding.minecraft_uuid,
    minecraft_name: binding.minecraft_name,
    bound_at: binding.created_at,
  });
});


app.post('/unbind', authMiddleware, async (c) => {
  const jwt = c.get('user');
  await premiumService.deletePremiumBinding(c.env.DB, jwt.uid);
  return success({ unbound: true });
});


app.get('/check/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }

  const isPremium = await premiumService.isPremiumPlayer(c.env.DB, uuid);
  return success({ uuid, is_premium: isPremium });
});


app.post('/authenticate', async (c) => {
  const body = await c.req.json<{ code: string }>();
  if (!body.code) {
    return error('Microsoft authorization code is required', 400);
  }

  const clientId = c.env.MICROSOFT_CLIENT_ID;
  const clientSecret = c.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return error('Microsoft OAuth not configured', 500);
  }

  const baseUrl = getBaseUrl(c);
  const redirectUri = `${baseUrl}/api/premium/callback`;

  const profile = await premiumService.verifyMicrosoftAccount(body.code, clientId, clientSecret, redirectUri);
  if (!profile) {
    return error('Failed to verify Microsoft account', 403);
  }


  const db = c.env.DB;
  const secret = readJwtSecret(c.env);
  let binding = await premiumService.getPremiumBindingByMinecraftUUID(db, profile.id);

  if (!binding) {

    const user = await userService.createUser(db, {
      username: profile.name,
      role: 'guest',
    });
    await userService.createPlayerProfile(db, user.id, profile.name);
    binding = await premiumService.createPremiumBinding(db, user.id, profile);
  }

  const user = await userService.getUserById(db, binding.user_id);
  if (!user) {
    return error('User not found', 500);
  }

  const { signJWT, generateUUID } = await import('../utils/crypto');
  const token = await signJWT(
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

  return success({
    token,
    user: {
      uuid: user.uuid,
      username: user.username,
      role: user.role,
      minecraft_uuid: binding.minecraft_uuid,
      minecraft_name: binding.minecraft_name,
    },
  });
});

export default app;
