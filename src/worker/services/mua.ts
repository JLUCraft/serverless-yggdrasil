import type { D1Database } from '@cloudflare/workers-types';
import type { MUABinding } from '../types';
import { hashUUIDToInternalId } from '../utils/crypto';

export interface MUAProfileResponse {
  id: string;
  name: string;
  source: string;           // 皮肤站代码
  sourceName: string;       // 皮肤站名称
  skins: Array<{
    url: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }>;
  capes?: Array<{ url: string }>;
  /**
   * Canonical club short-code.
   * Outgoing profiles always expose this as `club_code`.
   * `club` is retained only for backward-compat with
   * remote sites that may still send the old field name.
   */
  club?: string | null;
  club_code?: string | null;
}

export interface MUAUnionMappedResponse {
  internal_id: number;
  uuid: string;
  name: string;
  /**
   * Canonical club short-code.
   * Outgoing profiles always expose this as `club_code`.
   * `club` is retained only for backward-compat with
   * remote sites that may still send the old field name.
   */
  club?: string | null;
  club_code?: string | null;
  backend_scopes: {
    bind: string;
    all: string[];
  };
}

export interface MUASiteConfig {
  id: number;
  site_code: string;
  site_name: string;
  api_key: string | null;
  api_key_hash: string | null;
  union_endpoint: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface MUATrustedSite {
  id: number;
  site_code: string;
  site_name: string;
  endpoint: string;
  api_key_hash: string | null;
  enabled: number;
  created_at: number;
}

export async function getMUAConfig(db: D1Database): Promise<MUASiteConfig | null> {
  const row = await db
    .prepare('SELECT * FROM mua_config WHERE enabled = 1 LIMIT 1')
    .first<MUASiteConfig>();
  return row ?? null;
}

export async function getStoredConfig(db: D1Database): Promise<MUASiteConfig | null> {
  const row = await db
    .prepare('SELECT * FROM mua_config LIMIT 1')
    .first<MUASiteConfig>();
  return row ?? null;
}

export async function getTrustedSite(db: D1Database, siteCode: string): Promise<MUATrustedSite | null> {
  const row = await db
    .prepare('SELECT * FROM mua_trusted_sites WHERE site_code = ? AND enabled = 1')
    .bind(siteCode)
    .first<MUATrustedSite>();
  return row ?? null;
}

export async function getAllTrustedSites(db: D1Database): Promise<MUATrustedSite[]> {
  const { results } = await db
    .prepare('SELECT * FROM mua_trusted_sites WHERE enabled = 1')
    .all<MUATrustedSite>();
  return results ?? [];
}

/** Constant-time string comparison to prevent timing side-channel attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.min(a.length, b.length);
  let result = 0;
  for (let i = 0; i < len; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  // If lengths differ, force failure without short-circuit
  result |= a.length ^ b.length;
  return result === 0;
}

export async function verifyMUAAPIKey(db: D1Database, apiKey: string): Promise<boolean> {
  const config = await getMUAConfig(db);
  if (!config) return false;

  // P0-4: Hash-only comparison — no plaintext fallback
  if (config.api_key_hash) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
    const hash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
    return constantTimeEqual(hash, config.api_key_hash);
  }

  return false;
}

export async function getMUABindingBySource(
  db: D1Database,
  sourceSite: string,
  sourceUUID: string
): Promise<MUABinding | null> {
  const row = await db
    .prepare('SELECT * FROM mua_bindings WHERE source_site = ? AND source_uuid = ?')
    .bind(sourceSite, sourceUUID)
    .first<MUABinding>();
  return row ?? null;
}

export async function getMUABindingsByUser(db: D1Database, userId: number): Promise<MUABinding[]> {
  const { results } = await db
    .prepare('SELECT * FROM mua_bindings WHERE user_id = ?')
    .bind(userId)
    .all<MUABinding>();
  return results ?? [];
}

export async function createMUABinding(
  db: D1Database,
  userId: number,
  muaUUID: string,
  sourceSite: string,
  sourceUUID: string
): Promise<MUABinding> {
  await db
    .prepare(
      `INSERT INTO mua_bindings (user_id, mua_uuid, source_site, source_uuid)
       VALUES (?, ?, ?, ?)`
    )
    .bind(userId, muaUUID, sourceSite, sourceUUID)
    .run();

  const binding = await getMUABindingBySource(db, sourceSite, sourceUUID);
  if (!binding) throw new Error('Failed to create MUA binding');
  return binding;
}

export async function verifyMUABinding(db: D1Database, bindingId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE mua_bindings SET verified = 1, verified_at = unixepoch() WHERE id = ?`
    )
    .bind(bindingId)
    .run();
}

const DEFAULT_MUA_TIMEOUT_MS = 10000;

function createTimeoutSignal(ms: number = DEFAULT_MUA_TIMEOUT_MS): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Unwrap a remote JSON response that may be wrapped in the ApiSuccess
 * envelope {code, message, data}.  If the response is flat (no code/data
 * wrapper), return as-is; otherwise extract and return .data.
 */
function unwrapRemoteResponse<T>(json: unknown): T | null {
  if (json && typeof json === 'object' && 'code' in json && 'data' in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

// ---- Endpoint helpers ----
// Base site may be stored as root URL, /api/mua, or /api/union.
// These helpers normalise before building query paths.

/** Strip any known API suffix, returning the bare root URL. */
export function joinEndpoint(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  if (url.endsWith('/api/mua')) return url.slice(0, -'/api/mua'.length);
  if (url.endsWith('/api/union')) return url.slice(0, -'/api/union'.length);
  return url;
}

/** Ensure the base URL carries the /api/mua suffix. */
export function muaEndpoint(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  if (url.endsWith('/api/union')) url = url.slice(0, -'/api/union'.length);
  if (!url.endsWith('/api/mua')) url += '/api/mua';
  return url;
}

/** Ensure the base URL carries the /api/union suffix. */
export function unionEndpoint(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  if (url.endsWith('/api/mua')) url = url.slice(0, -'/api/mua'.length);
  if (!url.endsWith('/api/union')) url += '/api/union';
  return url;
}

// Query MUA Union API for cross-site player info (with auth)
export async function queryMUAUnion(
  endpoint: string,
  uuid: string,
  apiKey?: string
): Promise<MUAProfileResponse | null> {
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) {
      headers['X-MUA-API-Key'] = apiKey;
    }
    const resp = await fetch(`${muaEndpoint(endpoint)}/profile/${uuid}`, { headers, signal: createTimeoutSignal() });
    if (!resp.ok) return null;
    const json = await resp.json();
    return unwrapRemoteResponse<MUAProfileResponse>(json);
  } catch {
    return null;
  }
}

// Query MUA Union mapped profile by UUID
export async function queryMUAUnionMapped(
  endpoint: string,
  uuid: string,
  apiKey?: string
): Promise<MUAUnionMappedResponse | null> {
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) {
      headers['X-MUA-API-Key'] = apiKey;
    }
    const resp = await fetch(`${unionEndpoint(endpoint)}/profile/mapped/byuuid/${uuid}`, { headers, signal: createTimeoutSignal() });
    if (!resp.ok) return null;
    const json = await resp.json();
    return unwrapRemoteResponse<MUAUnionMappedResponse>(json);
  } catch {
    return null;
  }
}

// Query MUA Union mapped profile by player name
export async function queryMUAUnionMappedByName(
  endpoint: string,
  name: string,
  apiKey?: string
): Promise<MUAUnionMappedResponse | null> {
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) {
      headers['X-MUA-API-Key'] = apiKey;
    }
    const resp = await fetch(`${unionEndpoint(endpoint)}/profile/mapped/byname/${name}`, { headers, signal: createTimeoutSignal() });
    if (!resp.ok) return null;
    const json = await resp.json();
    return unwrapRemoteResponse<MUAUnionMappedResponse>(json);
  } catch {
    return null;
  }
}

// Query MUA Union API by player name
export async function queryMUAUnionByName(
  endpoint: string,
  name: string,
  apiKey?: string
): Promise<MUAProfileResponse | null> {
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) {
      headers['X-MUA-API-Key'] = apiKey;
    }
    const resp = await fetch(`${muaEndpoint(endpoint)}/profile/name/${name}`, { headers, signal: createTimeoutSignal() });
    if (!resp.ok) return null;
    const json = await resp.json();
    return unwrapRemoteResponse<MUAProfileResponse>(json);
  } catch {
    return null;
  }
}

// Build a MUA-compliant mapped profile response from local data
export function buildMappedProfile(
  uuid: string,
  name: string,
  source: string,
  bindingSite?: string
): MUAUnionMappedResponse {
  const allSites = [source];
  if (bindingSite && bindingSite !== source) {
    allSites.push(bindingSite);
  }
  return {
    internal_id: hashUUIDToInternalId(uuid),
    uuid,
    name,
    backend_scopes: {
      bind: bindingSite ?? source,
      all: allSites,
    },
  };
}

// Check if a UUID is from MUA (has binding in our DB or available via Union)
export async function isMUAPlayer(
  db: D1Database,
  endpoint: string,
  uuid: string,
  apiKey?: string
): Promise<boolean> {
  // Check local binding first
  const { results } = await db
    .prepare('SELECT id FROM mua_bindings WHERE mua_uuid = ? AND verified = 1')
    .bind(uuid)
    .all<{ id: number }>();
  if ((results ?? []).length > 0) return true;

  // Fall back to Union API query
  const profile = await queryMUAUnion(endpoint, uuid, apiKey);
  return profile !== null;
}

// Get the site code that a UUID belongs to (for admission control)
export async function resolveMUASource(
  db: D1Database,
  uuid: string
): Promise<{ source: string; sourceName: string } | null> {
  // Check if it's a local user
  const { results: localProfiles } = await db
    .prepare(
      `SELECT pp.name FROM player_profiles pp
       JOIN users u ON pp.user_id = u.id
       WHERE pp.uuid = ? AND u.status = 'active'`
    )
    .bind(uuid)
    .all<{ name: string }>();

  if ((localProfiles ?? []).length > 0) {
    const config = await getMUAConfig(db);
    if (config) {
      return { source: config.site_code, sourceName: config.site_name };
    }
  }

  // Check MUA bindings
  const { results: bindings } = await db
    .prepare('SELECT source_site FROM mua_bindings WHERE mua_uuid = ? AND verified = 1')
    .bind(uuid)
    .all<{ source_site: string }>();

  if (bindings && bindings.length > 0) {
    const siteCode = bindings[0]?.source_site;
    if (siteCode) {
      const trusted = await getTrustedSite(db, siteCode);
      if (trusted) {
        return { source: siteCode, sourceName: trusted.site_name };
      }
    }
  }

  return null;
}
