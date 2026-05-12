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
  getUnionPublicKey,
} from '../services/union';
import { getMUABindingsByUser, getAllTrustedSites, queryMUAUnion, queryMUAUnionByName, resolveMUASource } from '../services/mua';
import { getProfileByUUID, getProfileByName } from '../services/user';
import { getTextureById, getTextureData } from '../services/skin';
import { success, error, pngResponse } from '../utils/response';
import { hashUUIDToInternalId } from '../utils/crypto';

const app = new Hono<{ Bindings: Env }>();

app.get('/pubkey', async (c) => {
  const publicKey = await getUnionPublicKey(c.env.DB);
  if (!publicKey) {
    return c.json({ error: 'Public key not configured' }, 404);
  }
  return c.json({ public_key_pem: publicKey });
});

app.use('/member/*', unionVerifyMiddleware);

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

app.post('/member/updatelist', async (c) => {
  const body = await c.req.json<{ servers: Array<{ code: string; name: string; url: string }> }>();
  if (!body.servers || !Array.isArray(body.servers)) {
    return error('servers array is required', 400);
  }

  await updateServerList(c.env.DB, body.servers, 0);
  return success({ synced: true, count: body.servers.length });
});

app.post('/member/updateprivatekey', async (c) => {
  const body = await c.req.json<{ private_key_version: number; private_key: string; public_key?: string }>();
  if (!body.private_key) {
    return error('private_key is required', 400);
  }

  const value = body.public_key
    ? JSON.stringify({ private_key: body.private_key, public_key: body.public_key })
    : body.private_key;

  await setSecret(c.env.DB, 'private_key', value, body.private_key_version ?? 0);
  return success({ updated: true });
});

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

app.post('/member/updateplugin', async (_c) => {
  return success({ status: 'noop', message: 'Plugin update not applicable for serverless deployment' });
});

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

  const result: Record<string, unknown> = {
    internal_id: hashUUIDToInternalId(uuid),
    uuid,
    name,
    backend_scopes: {
      bind: bindingSites[0] ?? source.source,
      all: allSites,
    },
  };
  if (localProfile?.club) {
    result.club_code = localProfile.club;
  }

  return c.json(result);
});

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

  const mapped: Record<string, unknown> = {
    internal_id: hashUUIDToInternalId(localProfile.uuid),
    uuid: localProfile.uuid,
    name,
    backend_scopes: {
      bind: bindingSites[0] ?? siteCode,
      all: allSites,
    },
  };
  if (localProfile.club) {
    mapped.club_code = localProfile.club;
  }

  return c.json(mapped);
});

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
        return pngResponse(data);
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
          return pngResponse(await resp.arrayBuffer());
        }
      } catch {  }
    }
  }

  return error('Skin not found', 404);
});

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
        return pngResponse(data);
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
          return pngResponse(await resp.arrayBuffer());
        }
      } catch {  }
    }
  }

  return error('Skin not found', 404);
});

export default app;