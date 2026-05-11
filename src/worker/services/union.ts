import type { D1Database } from '@cloudflare/workers-types';
import type { UnionServer, UnionServerListRecord, UnionSecretRecord } from '../types';
import { unionEndpoint as normalizeUnionEndpoint } from './mua';

export async function getServerList(db: D1Database): Promise<UnionServerListRecord | null> {
  const row = await db
    .prepare('SELECT * FROM union_server_list ORDER BY id DESC LIMIT 1')
    .first<UnionServerListRecord>();
  return row ?? null;
}

export function parseServerList(record: UnionServerListRecord): UnionServer[] {
  try {
    return JSON.parse(record.servers_json) as UnionServer[];
  } catch {
    return [];
  }
}

export async function updateServerList(
  db: D1Database,
  servers: UnionServer[],
  version: number
): Promise<void> {
  const serversJson = JSON.stringify(servers);
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare('SELECT id FROM union_server_list LIMIT 1')
    .first<{ id: number }>();

  if (existing) {
    await db
      .prepare('UPDATE union_server_list SET servers_json = ?, version = ?, updated_at = ? WHERE id = ?')
      .bind(serversJson, version, now, existing.id)
      .run();
  } else {
    await db
      .prepare('INSERT INTO union_server_list (servers_json, version, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(serversJson, version, now, now)
      .run();
  }
}

export async function getSecret(
  db: D1Database,
  keyType: string
): Promise<UnionSecretRecord | null> {
  const row = await db
    .prepare('SELECT * FROM union_secrets WHERE key_type = ?')
    .bind(keyType)
    .first<UnionSecretRecord>();
  return row ?? null;
}

export async function setSecret(
  db: D1Database,
  keyType: string,
  keyValue: string,
  keyVersion: number
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO union_secrets (key_type, key_value, key_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key_type) DO UPDATE SET
         key_value = excluded.key_value,
         key_version = excluded.key_version,
         updated_at = excluded.updated_at`
    )
    .bind(keyType, keyValue, keyVersion, now, now)
    .run();
}

export async function deleteSecret(
  db: D1Database,
  keyType: string
): Promise<void> {
  await db
    .prepare('DELETE FROM union_secrets WHERE key_type = ?')
    .bind(keyType)
    .run();
}

export async function getUnionPublicKey(db: D1Database): Promise<string | null> {
  const record = await getSecret(db, 'union_public_key');
  return record?.key_value ?? null;
}

interface PrivateKeyBundle {
  private_key?: string;
  public_key?: string;
}

function parseKeyBundle(keyValue: string): PrivateKeyBundle {
  try {
    const parsed = JSON.parse(keyValue) as PrivateKeyBundle;
    if (parsed && typeof parsed === 'object' && parsed.private_key) {
      return parsed;
    }
  } catch {
    // Not JSON, treat as raw PEM private key
  }
  return { private_key: keyValue };
}

export async function getUnionPrivateKey(db: D1Database): Promise<string | null> {
  const record = await getSecret(db, 'private_key');
  if (!record) return null;
  const bundle = parseKeyBundle(record.key_value);
  return bundle.private_key ?? null;
}

export async function getTextureSignPublicKey(db: D1Database): Promise<string | null> {
  const record = await getSecret(db, 'private_key');
  if (!record) return null;
  const bundle = parseKeyBundle(record.key_value);
  return bundle.public_key ?? null;
}

export async function getBackendKey(db: D1Database): Promise<string | null> {
  const record = await getSecret(db, 'backend_key');
  return record?.key_value ?? null;
}

export async function triggerSync(
  db: D1Database,
  unionEndpoint: string,
  backendKey: string
): Promise<{ synced: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  let failed = 0;

  const { results: profiles } = await db
    .prepare(
      `SELECT pp.uuid, pp.name, u.email
       FROM player_profiles pp
       JOIN users u ON pp.user_id = u.id
       WHERE u.status = 'active'`
    )
    .all<{ uuid: string; name: string; email: string | null }>();

  if (!profiles || profiles.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  for (const profile of profiles) {
    try {
      const resp = await fetch(`${normalizeUnionEndpoint(unionEndpoint)}/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Union-Member-Key': backendKey,
          'X-MUA-API-Key': backendKey,
        },
        body: JSON.stringify({
          id: profile.uuid,
          name: profile.name,
          email: profile.email,
        }),
      });
      if (resp.ok) {
        synced++;
      } else {
        failed++;
        errors.push(`Failed to sync ${profile.name}: HTTP ${resp.status}`);
      }
    } catch (err: unknown) {
      failed++;
      errors.push(`Failed to sync ${profile.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return { synced, failed, errors };
}

export async function remapUUID(
  db: D1Database,
  fromUUID: string,
  toUUID: string
): Promise<boolean> {
  const profile = await db
    .prepare('SELECT id FROM player_profiles WHERE uuid = ?')
    .bind(fromUUID)
    .first<{ id: number }>();

  if (!profile) return false;

  const conflicting = await db
    .prepare('SELECT id FROM player_profiles WHERE uuid = ?')
    .bind(toUUID)
    .first<{ id: number }>();

  if (conflicting) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE player_profiles SET uuid = ?, updated_at = ? WHERE id = ?')
    .bind(toUUID, now, profile.id)
    .run();

  await db
    .prepare(
      `UPDATE mua_bindings SET mua_uuid = ? WHERE mua_uuid = ?`
    )
    .bind(toUUID, fromUUID)
    .run();

  return true;
}
