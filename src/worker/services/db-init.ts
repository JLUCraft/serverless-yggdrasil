import type { D1Database } from '@cloudflare/workers-types';
import siteConfig from '../../../site.config.json';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          email_verified INTEGER DEFAULT 0,
          email_domain TEXT,
          password_hash TEXT,
          username TEXT UNIQUE NOT NULL,
          role TEXT DEFAULT 'guest' CHECK(role IN ('guest','member','admin')),
          status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','banned')),
          club TEXT,
          peer_id TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          last_login_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS player_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          model TEXT DEFAULT 'default' CHECK(model IN ('default','slim')),
          skin_texture_id INTEGER,
          cape_texture_id INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS textures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT UNIQUE NOT NULL,
          hash TEXT NOT NULL,
          type TEXT CHECK(type IN ('skin','cape')),
          uploader_id INTEGER REFERENCES users(id),
          public INTEGER DEFAULT 1,
          metadata TEXT,
          created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS mua_bindings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          mua_uuid TEXT NOT NULL,
          source_site TEXT NOT NULL,
          source_uuid TEXT NOT NULL,
          verified INTEGER DEFAULT 0,
          verified_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          UNIQUE(source_site, source_uuid)
      );

      CREATE TABLE IF NOT EXISTS email_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          verification_token TEXT UNIQUE NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending','verified','expired')),
          user_id INTEGER REFERENCES users(id),
          created_at INTEGER DEFAULT (unixepoch()),
          verified_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS mua_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_code TEXT UNIQUE NOT NULL,
          site_name TEXT NOT NULL,
          api_key TEXT,
          api_key_hash TEXT,
          union_endpoint TEXT,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS mua_trusted_sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_code TEXT NOT NULL,
          site_name TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          api_key_hash TEXT,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (unixepoch()),
          UNIQUE(site_code)
      );

      CREATE TABLE IF NOT EXISTS union_server_list (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          servers_json TEXT NOT NULL DEFAULT '{}',
          version INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS union_secrets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key_type TEXT NOT NULL CHECK(key_type IN ('private_key','backend_key','union_public_key','texture_sign_public_key')),
          key_value TEXT NOT NULL,
          key_version INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          UNIQUE(key_type)
      );

      CREATE TABLE IF NOT EXISTS premium_bindings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          microsoft_uuid TEXT UNIQUE NOT NULL,
          minecraft_uuid TEXT UNIQUE NOT NULL,
          minecraft_name TEXT NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          expires_at INTEGER,
          verified INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          UNIQUE(user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON player_profiles(user_id);
      CREATE INDEX IF NOT EXISTS idx_profiles_name ON player_profiles(name);
      CREATE INDEX IF NOT EXISTS idx_textures_hash ON textures(hash);
      CREATE INDEX IF NOT EXISTS idx_mua_bindings_user ON mua_bindings(user_id);
      CREATE INDEX IF NOT EXISTS idx_mua_trusted_sites_code ON mua_trusted_sites(site_code);
      CREATE INDEX IF NOT EXISTS idx_premium_microsoft_uuid ON premium_bindings(microsoft_uuid);
      CREATE INDEX IF NOT EXISTS idx_premium_minecraft_uuid ON premium_bindings(minecraft_uuid);
      CREATE INDEX IF NOT EXISTS idx_premium_user_id ON premium_bindings(user_id);
      CREATE INDEX IF NOT EXISTS idx_union_secrets_type ON union_secrets(key_type);
    `,
  },
  {
    version: 2,
    name: 'auth_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS auth_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL CHECK(event_type IN ('login_success','login_failure','token_invalid','token_expired','register','logout','email_verified','password_reset')),
          user_id INTEGER REFERENCES users(id),
          username TEXT,
          ip_address TEXT,
          user_agent TEXT,
          details TEXT,
          created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_auth_logs_user ON auth_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_logs_event ON auth_logs(event_type);
      CREATE INDEX IF NOT EXISTS idx_auth_logs_created ON auth_logs(created_at);
    `,
  },
  {
    version: 3,
    name: 'clear_plaintext_mua_api_key',
    sql: `
      UPDATE mua_config SET api_key = NULL WHERE api_key IS NOT NULL;
    `,
  },
];

async function ensureMigrationsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER DEFAULT (unixepoch())
    )
  `).run();
}

async function getAppliedMigrations(db: D1Database): Promise<Set<number>> {
  const { results } = await db
    .prepare('SELECT version FROM schema_migrations')
    .all<{ version: number }>();
  return new Set((results ?? []).map((r) => r.version));
}

async function recordMigration(db: D1Database, version: number, name: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)')
    .bind(version, name)
    .run();
}

export async function initDatabase(db: D1Database): Promise<void> {
  await ensureMigrationsTable(db);

  const applied = await getAppliedMigrations(db);

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    const statements = migration.sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sql of statements) {
      await db.prepare(sql + ';').run();
    }

    await recordMigration(db, migration.version, migration.name);
  }

  // Seed initial config if missing
  const config = await db.prepare('SELECT id FROM mua_config LIMIT 1').first<{ id: number }>();
  if (!config) {
    await db
      .prepare('INSERT INTO mua_config (site_code, site_name, api_key, api_key_hash, union_endpoint) VALUES (?, ?, NULL, NULL, NULL)')
      .bind(siteConfig.siteCode, siteConfig.siteName)
      .run();
  }
}
