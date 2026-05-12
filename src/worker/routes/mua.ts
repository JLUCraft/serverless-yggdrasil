import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as userService from '../services/user';
import * as skinService from '../services/skin';
import * as muaService from '../services/mua';
import { success, error, pngResponse } from '../utils/response';
import { getBaseUrl } from '../utils/request';
import { hashUUIDToInternalId } from '../utils/crypto';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function resolveMUAStatus(
  db: Env['DB'],
  uuid: string
): Promise<{ source: string; sourceName: string } | null> {
  const localSource = await muaService.resolveMUASource(db, uuid);
  if (localSource) return localSource;

  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnion(site.endpoint, uuid);
    if (profile) {
      return { source: site.site_code, sourceName: site.site_name };
    }
  }

  return null;
}


async function muaAuth(c: import('hono').Context<{ Bindings: Env }>, next: () => Promise<void>): Promise<Response | void> {
  const apiKey = c.req.header('X-MUA-API-Key');
  if (!apiKey) {
    return error('Missing X-MUA-API-Key header', 401);
  }

  const valid = await muaService.verifyMUAAPIKey(c.env.DB, apiKey);
  if (!valid) {
    return error('Invalid API Key', 403);
  }

  await next();
  return undefined;
}


app.post('/bind', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const body = await c.req.json<{
    source_site: string;
    source_uuid: string;
    mua_uuid: string;
  }>();

  if (!body.source_site || !body.source_uuid || !body.mua_uuid) {
    return error('source_site, source_uuid, and mua_uuid are required', 400);
  }

  const db = c.env.DB;


  const trusted = await muaService.getTrustedSite(db, body.source_site);
  if (!trusted) {
    return error(`Site ${body.source_site} is not in trusted MUA list`, 403);
  }


  const existing = await muaService.getMUABindingBySource(db, body.source_site, body.source_uuid);
  if (existing) {
    return error('This MUA account is already bound', 409);
  }

  const binding = await muaService.createMUABinding(db, jwt.uid, body.mua_uuid, body.source_site, body.source_uuid);


  const profile = await muaService.queryMUAUnion(trusted.endpoint, body.mua_uuid);
  if (profile) {
    await muaService.verifyMUABinding(db, binding.id);
  }

  return success({
    id: binding.id,
    mua_uuid: binding.mua_uuid,
    source_site: binding.source_site,
    verified: binding.verified === 1,
  });
});


app.get('/bindings', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const db = c.env.DB;
  const bindings = await muaService.getMUABindingsByUser(db, jwt.uid);

  return success(
    bindings.map((b) => ({
      id: b.id,
      mua_uuid: b.mua_uuid,
      source_site: b.source_site,
      verified: b.verified === 1,
      verified_at: b.verified_at,
    }))
  );
});


app.get('/profile/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);


  const apiKey = c.req.header('X-MUA-API-Key');
  const isMachine = apiKey ? await muaService.verifyMUAAPIKey(db, apiKey) : false;


  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    const [skin, cape] = await Promise.all([
      localProfile.skin_texture_id ? skinService.getTextureById(db, localProfile.skin_texture_id) : null,
      localProfile.cape_texture_id ? skinService.getTextureById(db, localProfile.cape_texture_id) : null,
    ]);
    const result: Record<string, unknown> = {
      id: uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      source_name: config?.site_name ?? 'Unknown',
      skins: skin ? [{ url: `${baseUrl}/textures/${skin.hash}` }] : [],
      capes: cape ? [{ url: `${baseUrl}/textures/${cape.hash}` }] : [],
    };
    if (localProfile.club) {
      result.club_code = localProfile.club;
    }
    return isMachine ? c.json(result) : success(result);
  }


  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnion(site.endpoint, uuid);
    if (profile) {
      const result: Record<string, unknown> = {
        id: profile.id,
        name: profile.name,
        source: site.site_code,
        source_name: site.site_name,
        skins: profile.skins,
        capes: profile.capes,
      };
      const remoteClub = profile.club_code ?? profile.club ?? null;
      if (remoteClub) {
        result.club_code = remoteClub;
      }
      return isMachine ? c.json(result) : success(result);
    }
  }

  return error('MUA profile not found', 404);
});


app.get('/profile/name/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return error('Name is required', 400);
  }
  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);


  const apiKey = c.req.header('X-MUA-API-Key');
  const isMachine = apiKey ? await muaService.verifyMUAAPIKey(db, apiKey) : false;


  const localProfile = await userService.getProfileByName(db, name);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    const [skin, cape] = await Promise.all([
      localProfile.skin_texture_id ? skinService.getTextureById(db, localProfile.skin_texture_id) : null,
      localProfile.cape_texture_id ? skinService.getTextureById(db, localProfile.cape_texture_id) : null,
    ]);
    const result: Record<string, unknown> = {
      id: localProfile.uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      source_name: config?.site_name ?? 'Unknown',
      skins: skin ? [{ url: `${baseUrl}/textures/${skin.hash}` }] : [],
      capes: cape ? [{ url: `${baseUrl}/textures/${cape.hash}` }] : [],
    };
    if (localProfile.club) {
      result.club_code = localProfile.club;
    }
    return isMachine ? c.json(result) : success(result);
  }


  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnionByName(site.endpoint, name);
    if (profile) {
      const result: Record<string, unknown> = {
        id: profile.id,
        name: profile.name,
        source: site.site_code,
        source_name: site.site_name,
        skins: profile.skins,
        capes: profile.capes,
      };
      const remoteClub = profile.club_code ?? profile.club ?? null;
      if (remoteClub) {
        result.club_code = remoteClub;
      }
      return isMachine ? c.json(result) : success(result);
    }
  }

  return error('MUA profile not found', 404);
});


app.get('/check/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;

  const source = await resolveMUAStatus(db, uuid);
  return success({
    uuid,
    is_mua_member: source !== null,
    source: source?.source ?? null,
    source_name: source?.sourceName ?? null,
  });
});






app.get('/s2s/profile/:uuid', muaAuth, async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return c.json({ error: 'UUID is required' }, 400);
  }
  const db = c.env.DB;

  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    const result: Record<string, unknown> = {
      id: uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      source_name: config?.site_name ?? 'Unknown',
    };
    if (localProfile.club) {
      result.club_code = localProfile.club;
    }
    return c.json(result);
  }

  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnion(site.endpoint, uuid);
    if (profile) {
      const result: Record<string, unknown> = {
        id: profile.id,
        name: profile.name,
        source: site.site_code,
        source_name: site.site_name,
      };
      const remoteClub = profile.club_code ?? profile.club ?? null;
      if (remoteClub) {
        result.club_code = remoteClub;
      }
      return c.json(result);
    }
  }

  return c.json({ error: 'Profile not found' }, 404);
});


app.get('/s2s/profile/name/:name', muaAuth, async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }
  const db = c.env.DB;

  const localProfile = await userService.getProfileByName(db, name);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    const result: Record<string, unknown> = {
      id: localProfile.uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      source_name: config?.site_name ?? 'Unknown',
    };
    if (localProfile.club) {
      result.club_code = localProfile.club;
    }
    return c.json(result);
  }

  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnionByName(site.endpoint, name);
    if (profile) {
      const result: Record<string, unknown> = {
        id: profile.id,
        name: profile.name,
        source: site.site_code,
        source_name: site.site_name,
      };
      const remoteClub = profile.club_code ?? profile.club ?? null;
      if (remoteClub) {
        result.club_code = remoteClub;
      }
      return c.json(result);
    }
  }

  return c.json({ error: 'Profile not found' }, 404);
});


app.get('/s2s/check/:uuid', muaAuth, async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return c.json({ error: 'UUID is required' }, 400);
  }
  const db = c.env.DB;

  const source = await resolveMUAStatus(db, uuid);
  return c.json({
    uuid,
    is_mua_member: source !== null,
    source: source?.source ?? null,
    source_name: source?.sourceName ?? null,
  });
});




app.get('/union/profile/:uuid', muaAuth, async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);


  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    const [skin, cape] = await Promise.all([
      localProfile.skin_texture_id ? skinService.getTextureById(db, localProfile.skin_texture_id) : null,
      localProfile.cape_texture_id ? skinService.getTextureById(db, localProfile.cape_texture_id) : null,
    ]);
    const result: Record<string, unknown> = {
      id: uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      sourceName: config?.site_name ?? 'Unknown',
      skins: skin ? [{ url: `${baseUrl}/textures/${skin.hash}` }] : [],
      capes: cape ? [{ url: `${baseUrl}/textures/${cape.hash}` }] : [],
    };
    if (localProfile.club) {
      result.club_code = localProfile.club;
    }
    return success(result);
  }


  const { results } = await db
    .prepare('SELECT * FROM mua_bindings WHERE mua_uuid = ? AND verified = 1')
    .bind(uuid)
    .all<{ source_site: string }>();

  if (results && results.length > 0) {
    const siteCode = results[0]?.source_site;
    if (siteCode) {
      const trusted = await muaService.getTrustedSite(db, siteCode);
      if (trusted) {
        const remoteProfile = await muaService.queryMUAUnion(trusted.endpoint, uuid);
        if (remoteProfile) {
          const result: Record<string, unknown> = {
            id: remoteProfile.id,
            name: remoteProfile.name,
            source: siteCode,
            sourceName: trusted.site_name,
            skins: remoteProfile.skins,
            capes: remoteProfile.capes,
          };
          const remoteClub = remoteProfile.club_code ?? remoteProfile.club ?? null;
          if (remoteClub) {
            result.club_code = remoteClub;
          }
          return success(result);
        }
      }
    }
  }

  return error('Profile not found', 404);
});


app.get('/union/profile/mapped/byuuid/:uuid', muaAuth, async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;

  const source = await muaService.resolveMUASource(db, uuid);
  if (!source) {
    return error('Profile not found', 404);
  }


  const localProfile = await userService.getProfileByUUID(db, uuid);
  const name = localProfile?.name ?? 'unknown';


  const { results: bindings } = await db
    .prepare('SELECT source_site FROM mua_bindings WHERE mua_uuid = ? AND verified = 1')
    .bind(uuid)
    .all<{ source_site: string }>();
  const bindingSites = (bindings ?? []).map(b => b.source_site);
  const allSites = [source.source, ...bindingSites.filter(s => s !== source.source)];

  const mapped: Record<string, unknown> = {
    internal_id: hashUUIDToInternalId(uuid),
    uuid,
    name,
    backend_scopes: {
      bind: bindingSites[0] ?? source.source,
      all: allSites,
    },
  };
  if (localProfile?.club) {
    mapped.club_code = localProfile.club;
  }

  return success(mapped);
});


app.get('/union/profile/mapped/byname/:name', muaAuth, async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return error('Name is required', 400);
  }
  const db = c.env.DB;


  const localProfile = await userService.getProfileByName(db, name);
  if (!localProfile) {
    return error('Profile not found', 404);
  }

  const source = await muaService.resolveMUASource(db, localProfile.uuid);
  const siteCode = source?.source ?? 'unknown';


  const { results: bindings } = await db
    .prepare('SELECT source_site FROM mua_bindings WHERE mua_uuid = ? AND verified = 1')
    .bind(localProfile.uuid)
    .all<{ source_site: string }>();
  const bindingSites = (bindings ?? []).map(b => b.source_site);
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

  return success(mapped);
});


app.get('/union/skin/byname/:name', muaAuth, async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return error('Name is required', 400);
  }
  const db = c.env.DB;


  const localProfile = await userService.getProfileByName(db, name);
  if (localProfile?.skin_texture_id) {
    const texture = await skinService.getTextureById(db, localProfile.skin_texture_id);
    if (texture) {
      const data = await skinService.getTextureData(c.env.SKINS, texture.hash);
      if (data) {
        return pngResponse(data);
      }
    }
  }


  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnionByName(site.endpoint, name);
    if (profile?.skins && profile.skins.length > 0) {
      const skinUrl = profile.skins[0]?.url;
      if (!skinUrl) continue;
      try {
        const resp = await fetch(skinUrl);
        if (resp.ok) {
          return pngResponse(await resp.arrayBuffer());
        }
      } catch {

      }
    }
  }

  return error('Skin not found', 404);
});


app.get('/union/skin/byuuid/:uuid', muaAuth, async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;


  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile?.skin_texture_id) {
    const texture = await skinService.getTextureById(db, localProfile.skin_texture_id);
    if (texture) {
      const data = await skinService.getTextureData(c.env.SKINS, texture.hash);
      if (data) {
        return pngResponse(data);
      }
    }
  }


  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnion(site.endpoint, uuid);
    if (profile?.skins && profile.skins.length > 0) {
      const skinUrl = profile.skins[0]?.url;
      if (!skinUrl) continue;
      try {
        const resp = await fetch(skinUrl);
        if (resp.ok) {
          return pngResponse(await resp.arrayBuffer());
        }
      } catch {

      }
    }
  }

  return error('Skin not found', 404);
});




app.get('/trusted-sites', authMiddleware, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const sites = await muaService.getAllTrustedSites(db);
  return success(sites.map((s) => ({
    site_code: s.site_code,
    site_name: s.site_name,
    endpoint: s.endpoint,
    enabled: s.enabled === 1,
  })));
});


app.post('/trusted-sites', authMiddleware, requireRole('admin'), async (c) => {
  const body = await c.req.json<{
    site_code: string;
    site_name: string;
    endpoint: string;
    api_key?: string;
  }>();

  if (!body.site_code || !body.site_name || !body.endpoint) {
    return error('site_code, site_name, and endpoint are required', 400);
  }

  const db = c.env.DB;


  let apiKeyHash: string | null = null;
  if (body.api_key) {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body.api_key));
    apiKeyHash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
  }

  await db
    .prepare(
      `INSERT INTO mua_trusted_sites (site_code, site_name, endpoint, api_key_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(site_code) DO UPDATE SET
         site_name = excluded.site_name,
         endpoint = excluded.endpoint,
         api_key_hash = COALESCE(excluded.api_key_hash, api_key_hash)`
    )
    .bind(body.site_code, body.site_name, body.endpoint, apiKeyHash)
    .run();

  return success({ added: true });
});


app.get('/config', authMiddleware, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const config = await muaService.getStoredConfig(db);

  if (!config) {
    return error('MUA config not initialized', 500);
  }

  return success({
    site_code: config.site_code,
    site_name: config.site_name,
    api_key_configured: config.api_key_hash !== null,
    union_endpoint: config.union_endpoint,
    enabled: config.enabled === 1,
  });
});


app.patch('/config', authMiddleware, requireRole('admin'), async (c) => {
  const body = await c.req.json<{
    site_code?: string;
    site_name?: string;
    api_key?: string;
    union_endpoint?: string;
  }>();

  const db = c.env.DB;
  const config = await muaService.getStoredConfig(db);

  if (!config) {
    return error('MUA config not initialized', 500);
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.site_code !== undefined) {
    updates.push('site_code = ?');
    values.push(body.site_code);
  }
  if (body.site_name !== undefined) {
    updates.push('site_name = ?');
    values.push(body.site_name);
  }
  if (body.api_key !== undefined) {

    if (body.api_key) {
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body.api_key));
      const hash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
      updates.push('api_key_hash = ?');
      values.push(hash);
    } else {
      updates.push('api_key_hash = ?');
      values.push(null);
    }

    updates.push('api_key = NULL');
  }
  if (body.union_endpoint !== undefined) {
    updates.push('union_endpoint = ?');
    values.push(body.union_endpoint);
  }

  if (updates.length === 0) {
    return error('No fields to update', 400);
  }

  values.push(config.id);
  await db.prepare(`UPDATE mua_config SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const next = await muaService.getStoredConfig(db);
  if (!next) {
    return error('MUA config not initialized', 500);
  }

  return success({
    site_code: next.site_code,
    site_name: next.site_name,
    api_key_configured: next.api_key_hash !== null,
    union_endpoint: next.union_endpoint,
    enabled: next.enabled === 1,
  });
});

export default app;
