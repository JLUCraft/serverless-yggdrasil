import type { D1Database } from '@cloudflare/workers-types';
import type { User, PlayerProfile, UserRole } from '../types';
import { generateUUID, hashPassword, normalizeUUID } from '../utils/crypto';

export async function getUserByUUID(db: D1Database, uuid: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE uuid = ?').bind(normalizeUUID(uuid)).first<User>();
  return row ?? null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  return row ?? null;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
  return row ?? null;
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  return row ?? null;
}

export async function createUser(
  db: D1Database,
  data: {
    username: string;
    email?: string | null;
    password?: string;
    role?: UserRole;
    club?: string | null;
    peer_id?: string | null;
  }
): Promise<User> {
  const uuid = generateUUID();
  const passwordHash = data.password ? await hashPassword(data.password) : null;

  await db
    .prepare(
      `INSERT INTO users (uuid, email, password_hash, username, role, club, peer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      uuid,
      data.email ?? null,
      passwordHash,
      data.username,
      data.role ?? 'guest',
      data.club ?? null,
      data.peer_id ?? null
    )
    .run();

  const user = await getUserByUUID(db, uuid);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function updateUser(
  db: D1Database,
  userId: number,
  updates: Partial<Pick<User, 'email' | 'email_verified' | 'email_domain' | 'username' | 'role' | 'status' | 'club' | 'peer_id' | 'last_login_at'>>
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;

  values.push(userId);
  await db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function getPlayerProfiles(db: D1Database, userId: number): Promise<PlayerProfile[]> {
  const { results } = await db
    .prepare('SELECT * FROM player_profiles WHERE user_id = ?')
    .bind(userId)
    .all<PlayerProfile>();
  return results ?? [];
}

export async function getProfileByName(db: D1Database, name: string): Promise<(PlayerProfile & { user_uuid: string }) | null> {
  const row = await db
    .prepare(
      `SELECT pp.*, u.uuid as user_uuid
       FROM player_profiles pp
       JOIN users u ON pp.user_id = u.id
       WHERE pp.name = ?`
    )
    .bind(name)
    .first<PlayerProfile & { user_uuid: string }>();
  return row ?? null;
}

export async function getProfileByUUID(db: D1Database, uuid: string): Promise<(PlayerProfile & { user_uuid: string }) | null> {
  const row = await db
    .prepare(
      `SELECT pp.*, u.uuid as user_uuid
       FROM player_profiles pp
       JOIN users u ON pp.user_id = u.id
       WHERE pp.uuid = ?`
    )
    .bind(normalizeUUID(uuid))
    .first<PlayerProfile & { user_uuid: string }>();
  return row ?? null;
}

export async function createPlayerProfile(
  db: D1Database,
  userId: number,
  name: string,
  model: 'default' | 'slim' = 'default'
): Promise<PlayerProfile> {
  const uuid = generateUUID();
  await db
    .prepare(
      `INSERT INTO player_profiles (user_id, uuid, name, model)
       VALUES (?, ?, ?, ?)`
    )
    .bind(userId, uuid, name, model)
    .run();

  const profile = await db
    .prepare('SELECT * FROM player_profiles WHERE uuid = ?')
    .bind(uuid)
    .first<PlayerProfile>();

  if (!profile) throw new Error('Failed to create profile');
  return profile;
}

export async function updatePlayerProfile(
  db: D1Database,
  profileId: number,
  updates: Partial<Pick<PlayerProfile, 'name' | 'model' | 'skin_texture_id' | 'cape_texture_id'>>
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;

  values.push(profileId);
  await db.prepare(`UPDATE player_profiles SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function getUserWithProfiles(db: D1Database, userId: number): Promise<(User & { profiles: PlayerProfile[] }) | null> {
  const user = await getUserById(db, userId);
  if (!user) return null;
  const profiles = await getPlayerProfiles(db, userId);
  return { ...user, profiles };
}

export async function getUserByPeerId(db: D1Database, peerId: string): Promise<{ id: number; uuid: string } | null> {
  const row = await db
    .prepare('SELECT id, uuid FROM users WHERE peer_id = ?')
    .bind(peerId)
    .first<{ id: number; uuid: string }>();
  return row ?? null;
}

export async function getUserByMUABinding(db: D1Database, muaUUID: string): Promise<User | null> {
  const row = await db
    .prepare('SELECT u.* FROM users u JOIN mua_bindings mb ON u.id = mb.user_id WHERE mb.mua_uuid = ? AND mb.verified = 1')
    .bind(muaUUID)
    .first<User>();
  return row ?? null;
}

export async function createMUABinding(
  db: D1Database,
  userId: number,
  muaUUID: string,
  sourceSite: string,
  sourceUUID: string
): Promise<void> {
  await db
    .prepare('INSERT INTO mua_bindings (user_id, mua_uuid, source_site, source_uuid, verified) VALUES (?, ?, ?, ?, 1)')
    .bind(userId, muaUUID, sourceSite, sourceUUID)
    .run();
}
