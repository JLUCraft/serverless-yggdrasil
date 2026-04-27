import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import * as userService from '../services/user';
import * as skinService from '../services/skin';
import { success, error } from '../utils/response';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Upload skin/cape
app.post('/upload', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const form = await c.req.formData();
  const file = form.get('file') as File | null;
  const type = form.get('type');

  if (!file || typeof file === 'string') {
    return error('File is required', 400);
  }

  if (type !== 'skin' && type !== 'cape') {
    return error('Type must be skin or cape', 400);
  }

  if (file.size > 2 * 1024 * 1024) {
    return error('File too large (max 2MB)', 413);
  }

  const buffer = await file.arrayBuffer();

  // Validate PNG (simple magic number check)
  const header = new Uint8Array(buffer.slice(0, 8));
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!header.every((b, i) => b === pngMagic[i])) {
    return error('Only PNG files are supported', 400);
  }

  const db = c.env.DB;
  const texture = await skinService.saveTexture(db, c.env.SKINS, buffer, type, jwt.uid, {
    name: file.name,
  });

  return success({
    uuid: texture.uuid,
    hash: texture.hash,
    type: texture.type,
    url: `/textures/${texture.hash}`,
  });
});

// List textures available to the current user
app.get('/textures', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const rows = await skinService.getTextures(c.env.DB, jwt.uid);
  return success(
    rows.map((texture) => ({
      uuid: texture.uuid,
      hash: texture.hash,
      type: texture.type,
      url: `/textures/${texture.hash}`,
    }))
  );
});

// Get texture data
app.get('/textures/:hash', async (c) => {
  const hash = c.req.param('hash');
  const data = await skinService.getTextureData(c.env.SKINS, hash);
  if (!data) {
    return error('Texture not found', 404);
  }

  return new Response(data, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
});

// Delete texture
app.delete('/textures/:uuid', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const uuid = c.req.param('uuid');

  const db = c.env.DB;
  const texture = await skinService.getTextureByUUID(db, uuid);
  if (!texture) {
    return error('Texture not found', 404);
  }

  if (texture.uploader_id !== jwt.uid && jwt.role !== 'admin') {
    return error('Not authorized to delete this texture', 403);
  }

  const deleted = await skinService.deleteTexture(db, c.env.SKINS, texture.id);
  if (!deleted) {
    return error('Texture is in use and cannot be deleted', 409);
  }

  return success({ deleted: true });
});

// Assign skin/cape to profile
app.post('/profiles/:uuid/textures', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const profileUUID = c.req.param('uuid');
  const body = await c.req.json<{
    skin_texture_uuid?: string;
    cape_texture_uuid?: string;
    model?: 'default' | 'slim';
  }>();

  const db = c.env.DB;
  const profile = await userService.getProfileByUUID(db, profileUUID);
  if (!profile) {
    return error('Profile not found', 404);
  }

  if (profile.user_uuid !== jwt.sub && jwt.role !== 'admin') {
    return error('Not authorized', 403);
  }

  const updates: Parameters<typeof userService.updatePlayerProfile>[2] = {};

  if (body.skin_texture_uuid !== undefined) {
    const skin = await skinService.getTextureByUUID(db, body.skin_texture_uuid);
    if (!skin || skin.type !== 'skin') {
      return error('Invalid skin texture', 400);
    }
    if (skin.public !== 1 && skin.uploader_id !== jwt.uid && jwt.role !== 'admin') {
      return error('Not authorized to use this texture', 403);
    }
    updates.skin_texture_id = skin.id;
  }

  if (body.cape_texture_uuid !== undefined) {
    const cape = await skinService.getTextureByUUID(db, body.cape_texture_uuid);
    if (!cape || cape.type !== 'cape') {
      return error('Invalid cape texture', 400);
    }
    if (cape.public !== 1 && cape.uploader_id !== jwt.uid && jwt.role !== 'admin') {
      return error('Not authorized to use this texture', 403);
    }
    updates.cape_texture_id = cape.id;
  }

  if (body.model !== undefined) {
    if (body.model !== 'default' && body.model !== 'slim') {
      return error('Model must be default or slim', 400);
    }
    updates.model = body.model;
  }

  if (Object.keys(updates).length === 0) {
    return error('No profile changes provided', 400);
  }

  await userService.updatePlayerProfile(db, profile.id, updates);
  return success({ updated: true });
});

// List user's profiles
app.get('/profiles', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const db = c.env.DB;
  const profiles = await userService.getPlayerProfiles(db, jwt.uid);

  const enriched = await Promise.all(
    profiles.map(async (p) => {
      const skin = p.skin_texture_id ? await skinService.getTextureById(db, p.skin_texture_id) : null;
      const cape = p.cape_texture_id ? await skinService.getTextureById(db, p.cape_texture_id) : null;
      return {
        id: p.uuid,
        name: p.name,
        model: p.model,
        skin: skin ? { uuid: skin.uuid, hash: skin.hash, url: `/textures/${skin.hash}` } : null,
        cape: cape ? { uuid: cape.uuid, hash: cape.hash, url: `/textures/${cape.hash}` } : null,
      };
    })
  );

  return success(enriched);
});

// Create new profile
app.post('/profiles', authMiddleware, async (c) => {
  const jwt = c.get('user');
  const body = await c.req.json<{ name: string; model?: 'default' | 'slim' }>();

  if (!body.name || body.name.length < 3 || body.name.length > 16) {
    return error('Name must be 3-16 characters', 400);
  }

  const db = c.env.DB;

  // Check name availability
  const existing = await userService.getProfileByName(db, body.name);
  if (existing) {
    return error('Profile name already taken', 409);
  }

  if (body.model !== 'default' && body.model !== 'slim') {
    return error('Model must be default or slim', 400);
  }

  const profile = await userService.createPlayerProfile(db, jwt.uid, body.name, body.model);
  return success({
    id: profile.uuid,
    name: profile.name,
    model: profile.model,
  });
});

export default app;
