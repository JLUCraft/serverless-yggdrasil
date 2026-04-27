import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as userService from '../services/user';
import * as skinService from '../services/skin';
import * as muaService from '../services/mua';
import { success, error } from '../utils/response';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function getBaseUrl(c: { req: { header: (name: string) => string | undefined } }): string {
  const host = c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

// MUA API Key 认证中间件
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

// Bind MUA account
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

  // Check if source site is trusted
  const trusted = await muaService.getTrustedSite(db, body.source_site);
  if (!trusted) {
    return error(`Site ${body.source_site} is not in trusted MUA list`, 403);
  }

  // Check if binding already exists
  const existing = await muaService.getMUABindingBySource(db, body.source_site, body.source_uuid);
  if (existing) {
    return error('This MUA account is already bound', 409);
  }

  const binding = await muaService.createMUABinding(db, jwt.uid, body.mua_uuid, body.source_site, body.source_uuid);

  // Auto-verify if source is trusted MUA union endpoint
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

// List my MUA bindings
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

// Query MUA profile by UUID (public, no auth required for basic profile)
app.get('/profile/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);

  // Check local first
  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    return success({
      id: uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      sourceName: config?.site_name ?? 'Unknown',
      skins: localProfile.skin_texture_id
        ? [{ url: `${baseUrl}/textures/${localProfile.skin_texture_id}` }]
        : [],
      capes: localProfile.cape_texture_id
        ? [{ url: `${baseUrl}/textures/${localProfile.cape_texture_id}` }]
        : [],
    });
  }

  // Query trusted sites
  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnion(site.endpoint, uuid);
    if (profile) {
      return success({
        ...profile,
        source: site.site_code,
        sourceName: site.site_name,
      });
    }
  }

  return error('MUA profile not found', 404);
});

// Query MUA profile by name (public)
app.get('/profile/name/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return error('Name is required', 400);
  }
  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);

  // Check local first
  const localProfile = await userService.getProfileByName(db, name);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    return success({
      id: localProfile.uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      sourceName: config?.site_name ?? 'Unknown',
      skins: localProfile.skin_texture_id
        ? [{ url: `${baseUrl}/textures/${localProfile.skin_texture_id}` }]
        : [],
      capes: localProfile.cape_texture_id
        ? [{ url: `${baseUrl}/textures/${localProfile.cape_texture_id}` }]
        : [],
    });
  }

  // Query trusted sites
  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnionByName(site.endpoint, name);
    if (profile) {
      return success({
        ...profile,
        source: site.site_code,
        sourceName: site.site_name,
      });
    }
  }

  return error('MUA profile not found', 404);
});

// Check if player is MUA member (for instance admission control)
app.get('/check/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;

  const source = await muaService.resolveMUASource(db, uuid);
  return success({
    uuid,
    is_mua_member: source !== null,
    source: source?.source ?? null,
    source_name: source?.sourceName ?? null,
  });
});

// ===== Union API (需要 API Key 认证) =====

// Union API: Return profile with site code for a UUID
app.get('/union/profile/:uuid', muaAuth, async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;
  const baseUrl = getBaseUrl(c);

  // Check local profiles
  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile) {
    const config = await muaService.getMUAConfig(db);
    return success({
      id: uuid,
      name: localProfile.name,
      source: config?.site_code ?? 'unknown',
      sourceName: config?.site_name ?? 'Unknown',
      skins: localProfile.skin_texture_id
        ? [{ url: `${baseUrl}/textures/${localProfile.skin_texture_id}` }]
        : [],
      capes: localProfile.cape_texture_id
        ? [{ url: `${baseUrl}/textures/${localProfile.cape_texture_id}` }]
        : [],
    });
  }

  // Check MUA bindings and forward
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
          return success({
            ...remoteProfile,
            source: siteCode,
            sourceName: trusted.site_name,
          });
        }
      }
    }
  }

  return error('Profile not found', 404);
});

// Union API: Mapped by UUID (返回精简格式，包含皮肤站代码)
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

  // Get profile name
  const localProfile = await userService.getProfileByUUID(db, uuid);
  const name = localProfile?.name ?? 'unknown';

  return success({
    uuid,
    name,
    source: source.source,
  });
});

// Union API: Get skin image by player name
app.get('/union/skin/byname/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return error('Name is required', 400);
  }
  const db = c.env.DB;

  // Find local profile
  const localProfile = await userService.getProfileByName(db, name);
  if (localProfile?.skin_texture_id) {
    const texture = await skinService.getTextureById(db, localProfile.skin_texture_id);
    if (texture) {
      const data = await skinService.getTextureData(c.env.SKINS, texture.hash);
      if (data) {
        return new Response(data, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      }
    }
  }

  // Try trusted sites
  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnionByName(site.endpoint, name);
    if (profile?.skins && profile.skins.length > 0) {
      const skinUrl = profile.skins[0]?.url;
      if (!skinUrl) continue;
      try {
        const resp = await fetch(skinUrl);
        if (resp.ok) {
          const data = await resp.arrayBuffer();
          return new Response(data, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=31536000',
            },
          });
        }
      } catch {
        // Continue to next site
      }
    }
  }

  return error('Skin not found', 404);
});

// Union API: Get skin image by UUID
app.get('/union/skin/byuuid/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid) {
    return error('UUID is required', 400);
  }
  const db = c.env.DB;

  // Find local profile
  const localProfile = await userService.getProfileByUUID(db, uuid);
  if (localProfile?.skin_texture_id) {
    const texture = await skinService.getTextureById(db, localProfile.skin_texture_id);
    if (texture) {
      const data = await skinService.getTextureData(c.env.SKINS, texture.hash);
      if (data) {
        return new Response(data, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      }
    }
  }

  // Try trusted sites
  const trustedSites = await muaService.getAllTrustedSites(db);
  for (const site of trustedSites) {
    const profile = await muaService.queryMUAUnion(site.endpoint, uuid);
    if (profile?.skins && profile.skins.length > 0) {
      const skinUrl = profile.skins[0]?.url;
      if (!skinUrl) continue;
      try {
        const resp = await fetch(skinUrl);
        if (resp.ok) {
          const data = await resp.arrayBuffer();
          return new Response(data, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=31536000',
            },
          });
        }
      } catch {
        // Continue to next site
      }
    }
  }

  return error('Skin not found', 404);
});

// ===== 管理端点 (Admin only) =====

// List trusted MUA sites
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

// Add trusted MUA site
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

  // Hash API key if provided
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

// Get MUA config (admin only, includes plaintext api_key for easy sharing)
app.get('/config', authMiddleware, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const config = await muaService.getMUAConfig(db);

  if (!config) {
    return error('MUA config not initialized', 500);
  }

  return success({
    site_code: config.site_code,
    site_name: config.site_name,
    api_key: config.api_key,
    union_endpoint: config.union_endpoint,
    enabled: config.enabled === 1,
  });
});

// Update MUA config (site code, api_key, etc.)
app.patch('/config', authMiddleware, requireRole('admin'), async (c) => {
  const body = await c.req.json<{
    site_code?: string;
    site_name?: string;
    api_key?: string;
    union_endpoint?: string;
  }>();

  const db = c.env.DB;
  const config = await muaService.getMUAConfig(db);

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
    updates.push('api_key = ?');
    values.push(body.api_key);
    // Also update hash for compatibility
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

  return success({ updated: true });
});

export default app;
