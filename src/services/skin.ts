import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Texture } from '../types';
import { generateUUID, hashTexture } from '../utils/crypto';

export async function getTextureByUUID(db: D1Database, uuid: string): Promise<Texture | null> {
  const row = await db.prepare('SELECT * FROM textures WHERE uuid = ?').bind(uuid).first<Texture>();
  return row ?? null;
}

export async function getTextureByHash(db: D1Database, hash: string): Promise<Texture | null> {
  const row = await db.prepare('SELECT * FROM textures WHERE hash = ?').bind(hash).first<Texture>();
  return row ?? null;
}

export async function getTextureById(db: D1Database, id: number): Promise<Texture | null> {
  const row = await db.prepare('SELECT * FROM textures WHERE id = ?').bind(id).first<Texture>();
  return row ?? null;
}

export async function getTextures(db: D1Database, userId: number): Promise<Texture[]> {
  const { results } = await db
    .prepare('SELECT * FROM textures WHERE public = 1 OR uploader_id = ? ORDER BY created_at DESC, id DESC')
    .bind(userId)
    .all<Texture>();
  return results ?? [];
}

export async function saveTexture(
  db: D1Database,
  bucket: R2Bucket,
  data: ArrayBuffer,
  type: 'skin' | 'cape',
  uploaderId: number,
  metadata: Record<string, unknown> | null
): Promise<Texture> {
  const hash = hashTexture(data);

  // Deduplication: return existing texture if hash matches
  const existing = await getTextureByHash(db, hash);
  if (existing) {
    return existing;
  }

  const uuid = generateUUID();

  // Upload to R2
  await bucket.put(`textures/${hash}`, data, {
    httpMetadata: { contentType: type === 'skin' ? 'image/png' : 'image/png' },
  });

  await db
    .prepare(
      `INSERT INTO textures (uuid, hash, type, uploader_id, metadata)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(uuid, hash, type, uploaderId, metadata === null ? null : JSON.stringify(metadata))
    .run();

  const texture = await getTextureByUUID(db, uuid);
  if (!texture) throw new Error('Failed to save texture');
  return texture;
}

export async function getTextureData(bucket: R2Bucket, hash: string): Promise<Uint8Array | null> {
  const obj = await bucket.get(`textures/${hash}`);
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}

export async function deleteTexture(
  db: D1Database,
  bucket: R2Bucket,
  textureId: number
): Promise<boolean> {
  const texture = await getTextureById(db, textureId);
  if (!texture) return false;

  // Check if texture is still referenced by any profile
  const { results } = await db
    .prepare('SELECT id FROM player_profiles WHERE skin_texture_id = ? OR cape_texture_id = ?')
    .bind(textureId, textureId)
    .all<{ id: number }>();

  if ((results ?? []).length > 0) {
    return false; // Cannot delete referenced texture
  }

  await db.prepare('DELETE FROM textures WHERE id = ?').bind(textureId).run();
  await bucket.delete(`textures/${texture.hash}`);
  return true;
}
