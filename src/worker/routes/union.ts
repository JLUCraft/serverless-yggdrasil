import { Hono } from 'hono';
import type { Env } from '../types';
import { unionVerifyMiddleware } from '../middleware/union-verify';
import {
  getServerList,
  parseServerList,
  updateServerList,
  getSecret,
  setSecret,
  triggerSync,
  remapUUID,
  getBackendKey,
} from '../services/union';
import { getMUABindingsByUser, getAllTrustedSites, queryMUAUnion, queryMUAUnionByName, resolveMUASource } from '../services/mua';
import { getProfileByUUID, getProfileByName } from '../services/user';
import { getTextureById, getTextureData } from '../services/skin';
import { success, error } from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.use('/member/*', unionVerifyMiddleware);

// Hello / status — allows the union hub to discover this member
app.get('/member/', async (c) => {
  const serverList = await getServerList(c.env.DB);
  const privateKey = await getSecret(c.env.DB, 'private_key');
  return c.json({
    yggdrasilApiVersion: '1.0.0',
    serverListVersion: serverList?.version ?? 0,
    privateKeyVersion: privateKey?.key_version ?? 0,
    enabledFeatures: ['unionBlacklist'],
  });
});

// Receive updated list of all union member servers
app.post('/member/updatelist', async (c) => {
  const body = await c.req.json<{ servers: Array<{ code: string; name: string; url: string }> }>();
  if (!body.servers || !Array.isArray(body.servers)) {
    return error('servers array is required', 400);
  }

  await updateServerList(c.env.DB, body.servers, 0);
  return success({ synced: true, count: body.servers.length });
});

// Receive union shared private key for texture signing
app.post('/member/updateprivatekey', async (c) => {
  const body = await c.req.json<{ private_key_version: number; private_key: string; public_key?: string }>();
  if (!body.private_key) {
    return error('private_key is required', 400);
  }

  // Store as JSON bundle if public_key is provided, otherwise raw PEM for backwards compatibility
  const value = body.public_key
    ? JSON.stringify({ private_key: body.private_key, public_key: body.public_key })
    : body.private_key;

  await setSecret(c.env.DB, 'private_key', value, body.private_key_version ?? 0);
  return success({ updated: true });
});

// Receive backend key and union public key for OAuth2
app.post('/member/updatebackendkey', async (c) => {
  const body = await c.req.json<{ backend_key: string; union_public_key: string }>();
  if (!body.backend_key) {
    return error('backend_key is required', 400);
  }

  await setSecret(c.env.DB, 'backend_key', body.backend_key, 0);
  if (body.union_public_key) {
    await setSecret(c.env.DB, 'union_public_key', body.union_public_key, 0);
  }
  return success({ updated: true });
});

// Trigger data sync — push local player profiles to union hub
app.post('/member/sync', async (c) => {
  const unionEndpoint = c.env.MUA_UNION_ENDPOINT;
  if (!unionEndpoint) {
    return error('Union endpoint not configured', 500);
  }

  const backendKey = await getBackendKey(c.env.DB);
  if (!backendKey) {
    return error('Backend key not configured', 500);
  }

  const result = await triggerSync(c.env.DB, unionEndpoint, backendKey);
  return success(result);
});

// Remap UUID — handles name/UUID collision cases across union members
app.post('/member/remapuuid', async (c) => {
  const body = await c.req.json<{ from_uuid: string; to_uuid: string }>();
  if (!body.from_uuid || !body.to_uuid) {
    return error('from_uuid and to_uuid are required', 400);
  }

  const ok = await remapUUID(c.env.DB, body.from_uuid, body.to_uuid);
  if (!ok) {
    return error('UUID remap failed — source profile not found or target UUID already in use', 400);
  }

  return success({ remapped: true });
});

// Update plugin — support auto-update of the union addon (no-op for serverless)
app.post('/member/updateplugin', async (_c) => {
  return success({ status: 'noop', message: 'Plugin update not applicable for serverless deployment' });
});

// Diagnostic — allows union hub to verify this member's connectivity
app.post('/member/diagnose', async (c) => {
  const unionEndpoint = c.env.MUA_UNION_ENDPOINT;
  const backendKey = await getBackendKey(c.env.DB);
  const privateKey = await getSecret(c.env.DB, 'private_key');
  const publicKey = await getSecret(c.env.DB, 'union_public_key');
  const serverList = await getServerList(c.env.DB);

  return success({
    endpoint: unionEndpoint,
    backend_key_configured: backendKey !== null,
    private_key_configured: privateKey !== null,
    public_key_configured: publicKey !== null,
    server_list_count: serverList ? parseServerList(serverList).length : 0,
  });
});

// Query email — check if an email belongs to a member site player
app.get('/member/queryemail', async (c) => {
  const email = c.req.query('email');
  if (!email) {
    return error('email query parameter is required', 400);
  }

  const { results } = await c.env.DB
    .prepare('SELECT uuid, username FROM users WHERE email = ? AND status = ?')
    .bind(email.toLowerCase().trim(), 'active')
    .all<{ uuid: string; username: string }>();

  if (!results || results.length === 0) {
    return success({ found: false });
  }

  return success({
    found: true,
    players: results,
    count: results.length,
  });
});

// ===== Public Union API (MUA standard format, machine-consumable) =====

function hashInternalId(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = ((hash << 5) - hash) + uuid.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Profile mapped by UUID (MUA standard format)
app.get('/profile/mapped/byuuid/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) return c.json({ error: 'UUID is required' }, 400);
  const db = c.env.DB;

  const source = await resolveMUASource(db, uuid);
  if (!source) return c.json({ error: 'Profile not found' }, 404);

  const localProfile = await getProfileByUUID(db, uuid);
  const name = localProfile?.name ?? 'unknown';

  const bindings = await getMUABindingsByUser(db, localProfile?.user_id ?? 0);
  const bindingSites = bindings.map(b => b.source_site);
  const allSites = [source.source, ...bindingSites.filter(s => s !== source.source)];

  return c.json({
    internal_id: hashInternalId(uuid),
    uuid,
    name,
    backend_scopes: {
      bind: bindingSites[0] ?? source.source,
      all: allSites,
    },
  });
});

// Profile mapped by name (MUA standard format)
app.get('/profile/mapped/byname/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) return c.json({ error: 'Name is required' }, 400);
  const db = c.env.DB;

  const localProfile = await getProfileByName(db, name);
  if (!localProfile) return c.json({ error: 'Profile not found' }, 404);

  const source = await resolveMUASource(db, localProfile.uuid);
  const siteCode = source?.source ?? 'unknown';

  const bindings = await getMUABindingsByUser(db, localProfile.user_id ?? 0);
  const bindingSites = bindings.map(b => b.source_site);
  const allSites = [siteCode, ...bindingSites.filter(s => s !== siteCode)];

  return c.json({
    internal_id: hashInternalId(localProfile.uuid),
    uuid: localProfile.uuid,
    name,
    backend_scopes: {
      bind: bindingSites[0] ?? siteCode,
      all: allSites,
    },
  });
});

// Skin by player name (MUA standard format — returns PNG)
app.get('/skin/byname/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) return error('Name is required', 400);
  const db = c.env.DB;

  const localProfile = await getProfileByName(db, name);
  if (localProfile?.skin_texture_id) {
    const texture = await getTextureById(db, localProfile.skin_texture_id);
    if (texture) {
      const data = await getTextureData(c.env.SKINS, texture.hash);
      if (data) {
        return new Response(data, {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
        });
      }
    }
  }

  const trustedSites = await getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await queryMUAUnionByName(site.endpoint, name);
    if (profile?.skins && profile.skins.length > 0) {
      const skinUrl = profile.skins[0]?.url;
      if (!skinUrl) continue;
      try {
        const resp = await fetch(skinUrl);
        if (resp.ok) {
          const data = await resp.arrayBuffer();
          return new Response(data, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
          });
        }
      } catch { /* try next */ }
    }
  }

  return error('Skin not found', 404);
});

// Skin by UUID (MUA standard format — returns PNG)
app.get('/skin/byuuid/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) return error('UUID is required', 400);
  const db = c.env.DB;

  const localProfile = await getProfileByUUID(db, uuid);
  if (localProfile?.skin_texture_id) {
    const texture = await getTextureById(db, localProfile.skin_texture_id);
    if (texture) {
      const data = await getTextureData(c.env.SKINS, texture.hash);
      if (data) {
        return new Response(data, {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
        });
      }
    }
  }

  const trustedSites = await getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await queryMUAUnion(site.endpoint, uuid);
    if (profile?.skins && profile.skins.length > 0) {
      const skinUrl = profile.skins[0]?.url;
      if (!skinUrl) continue;
      try {
        const resp = await fetch(skinUrl);
        if (resp.ok) {
          const data = await resp.arrayBuffer();
          return new Response(data, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
          });
        }
      } catch { /* try next */ }
    }
  }

  return error('Skin not found', 404);
});

export default app;
