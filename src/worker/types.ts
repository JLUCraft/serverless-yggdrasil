// === App Bindings ===

export interface Env {
  DB: D1Database;
  SKINS: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  APP_NAME: string;
  MUA_UNION_ENDPOINT: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  EMAIL_VERIFICATION_RECIPIENT: string;
  EMAIL_VERIFICATION_TOKEN_BYTES: string;
  EMAIL_VERIFICATION_TTL_SECONDS: string;
  /** Comma-separated list of allowed CORS origins. Defaults to local development origins. */
  ALLOWED_ORIGINS?: string;
}

// === Identity Roles ===

export type UserRole = 'guest' | 'member' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'banned';

// === Database Models ===

export interface User {
  id: number;
  uuid: string;
  email: string | null;
  email_verified: number;
  email_domain: string | null;
  password_hash: string | null;
  username: string;
  role: UserRole;
  status: UserStatus;
  club: string | null;
  peer_id: string | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface PlayerProfile {
  id: number;
  user_id: number;
  uuid: string;
  name: string;
  model: 'default' | 'slim';
  skin_texture_id: number | null;
  cape_texture_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface Texture {
  id: number;
  uuid: string;
  hash: string;
  type: 'skin' | 'cape';
  uploader_id: number | null;
  public: number;
  metadata: string | null;
  created_at: number;
}

export interface MUABinding {
  id: number;
  user_id: number;
  mua_uuid: string;
  source_site: string;
  source_uuid: string;
  verified: number;
  verified_at: number | null;
  created_at: number;
}

export interface EmailVerification {
  id: number;
  email: string;
  verification_token: string;
  status: 'pending' | 'verified' | 'expired';
  user_id: number | null;
  created_at: number;
  verified_at: number | null;
}

// === Yggdrasil API Types ===

export interface YggdrasilAgent {
  name: string;
  version: number;
}

export interface YggdrasilAuthRequest {
  username: string;
  password: string;
  clientToken?: string;
  requestUser?: boolean;
  agent?: YggdrasilAgent;
}

export interface YggdrasilRefreshRequest {
  accessToken: string;
  clientToken?: string;
  requestUser?: boolean;
  selectedProfile?: {
    id: string;
    name: string;
  };
}

export interface YggdrasilProfile {
  id: string;
  name: string;
  properties?: Array<{
    name: string;
    value: string;
    signature?: string;
  }>;
  /**
   * Canonical club short-code (e.g. "JLUCraft").
   *
   * The database column `users.club` stores a single short
   * identifier — there is no separate display-name field.
   * MUA / Union extension profile endpoints expose this
   * canonical code exclusively as `club_code`.
   */
  club_code?: string | null;
}

export interface YggdrasilTexturesProperty {
  timestamp: number;
  profileId: string;
  profileName: string;
  signatureRequired: boolean;
  textures: Record<string, {
    url: string;
    metadata?: {
      model?: 'slim';
    };
  }>;
}

// === API Response Types ===

export interface ApiError {
  error: string;
  errorMessage: string;
  cause?: string;
}

export interface ApiSuccess<T> {
  code: number;
  message: string;
  data: T;
}

// === JWT Payload ===

export interface JWTPayload {
  sub: string;      // user uuid
  uid: number;      // user id
  role: UserRole;
  iat: number;
  exp: number;
  jti: string;      // token id
}

// === Union Protocol Types ===

export interface UnionServer {
  code: string;
  name: string;
  url: string;
}

export interface UnionServerListRecord {
  id: number;
  servers_json: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface UnionSecretRecord {
  id: number;
  key_type: 'private_key' | 'backend_key' | 'union_public_key';
  key_value: string;
  key_version: number;
  created_at: number;
  updated_at: number;
}

export interface UnionMemberUpdateListRequest {
  servers: UnionServer[];
}

export interface UnionMemberUpdatePrivateKeyRequest {
  private_key_version: number;
  private_key: string;
}

export interface UnionMemberUpdateBackendKeyRequest {
  backend_key: string;
  union_public_key: string;
}

export interface UnionMemberSyncResponse {
  synced: number;
  failed: number;
  errors: string[];
}

export interface UnionMemberRemapUUIDRequest {
  from_uuid: string;
  to_uuid: string;
}

export interface UnionMemberUpdatePluginRequest {
  version: string;
  url: string;
  hash: string;
}

// === Hono Variables ===

export type Variables = {
  user: JWTPayload;
};
