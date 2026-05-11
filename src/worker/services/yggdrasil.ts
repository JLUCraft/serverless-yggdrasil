import type { D1Database } from '@cloudflare/workers-types';
import type {
  YggdrasilAuthRequest,
  YggdrasilRefreshRequest,
  YggdrasilProfile,
  User,
  PlayerProfile,
} from '../types';
import { getUserByUsername, getUserByUUID, getProfileByUUID, getProfileByName, getPlayerProfiles } from './user';
import { getTextureById } from './skin';
import { getUnionPrivateKey } from './union';
import { verifyPassword, generateUUID, signJWT, verifyJWT, rsaPkcs1Sha256Sign, toUndashedUUID } from '../utils/crypto';

export async function authenticate(
  db: D1Database,
  req: YggdrasilAuthRequest,
  secret: string
): Promise<
  | {
      accessToken: string;
      clientToken: string;
      availableProfiles: Array<{ id: string; name: string }>;
      selectedProfile: { id: string; name: string } | null;
      _userId: number;
      user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
    }
  | null
> {
  const user = await getUserByUsername(db, req.username);
  if (!user || !user.password_hash) return null;
  if (user.status !== 'active') return null;

  const valid = await verifyPassword(req.password, user.password_hash);
  if (!valid) return null;

  const profiles = await getPlayerProfiles(db, user.id);
  const availableProfiles = profiles.map((p) => ({ id: toUndashedUUID(p.uuid), name: p.name }));
  const selectedProfile = availableProfiles[0] ?? null;

  const clientToken = req.clientToken ?? generateUUID();
  const accessToken = await generateAccessToken(user, clientToken, secret);

  const result: {
    accessToken: string;
    clientToken: string;
    availableProfiles: Array<{ id: string; name: string }>;
    selectedProfile: { id: string; name: string } | null;
    _userId: number;
    user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
  } = {
    accessToken,
    clientToken,
    availableProfiles,
    selectedProfile,
    _userId: user.id,
  };

  if (req.requestUser) {
    result.user = {
      id: toUndashedUUID(user.uuid),
      username: user.username,
      properties: [],
    };
  }

  return result;
}

export async function refresh(
  db: D1Database,
  req: YggdrasilRefreshRequest,
  secret: string
): Promise<
  | {
      accessToken: string;
      clientToken: string;
      selectedProfile: { id: string; name: string } | null;
      availableProfiles: Array<{ id: string; name: string }>;
      _userId: number;
      user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
    }
  | null
> {
  // Verify the old token to extract user info
  let user: User | null = null;
  let profile: PlayerProfile | null = null;
  let resolvedClientToken: string | null = null;

  if (req.accessToken) {
    const payload = await verifyJWT<{ sub: string; uid: number; clientToken: string }>(req.accessToken, secret);
    if (payload) {
      // P0-1: Validate clientToken binding — if the request provides one,
      // it MUST match the clientToken embedded in the old access token.
      // If the request omits it, reuse the existing clientToken.
      if (req.clientToken !== undefined && req.clientToken !== payload.clientToken) {
        return null;
      }
      resolvedClientToken = req.clientToken ?? payload.clientToken;

      user = await getUserByUUID(db, payload.sub);
      if (user && req.selectedProfile) {
        const p = await getProfileByUUID(db, req.selectedProfile.id);
        if (p && p.user_uuid === user.uuid) {
          profile = p;
        }
      }
      // If no selectedProfile requested, use the user's first profile
      if (user && !profile) {
        const profiles = await getPlayerProfiles(db, user.id);
        profile = profiles[0] ?? null;
      }
    }
  }

  if (!user) return null;

  if (!resolvedClientToken) return null;

  const clientToken = resolvedClientToken;
  const accessToken = await generateAccessToken(user, clientToken, secret);

  const selectedProfile = profile ? { id: toUndashedUUID(profile.uuid), name: profile.name } : null;
  const result: {
    accessToken: string;
    clientToken: string;
    selectedProfile: { id: string; name: string } | null;
    availableProfiles: Array<{ id: string; name: string }>;
    _userId: number;
    user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
  } = {
    accessToken,
    clientToken,
    selectedProfile,
    availableProfiles: selectedProfile ? [selectedProfile] : [],
    _userId: user.id,
  };

  if (req.requestUser) {
    result.user = {
      id: toUndashedUUID(user.uuid),
      username: user.username,
      properties: [],
    };
  }

  return result;
}

async function generateAccessToken(user: User, clientToken: string, secret: string): Promise<string> {
  const payload = {
    sub: user.uuid,
    uid: user.id,
    clientToken,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  };
  return signJWT(payload, secret);
}

export async function validateToken(
  accessToken: string,
  clientToken: string | undefined,
  secret: string
): Promise<{ uuid: string; name: string; userId: number } | null> {
  const payload = await verifyJWT<{ sub: string; uid: number; clientToken: string }>(accessToken, secret);
  if (!payload) return null;
  if (clientToken !== undefined && payload.clientToken !== clientToken) return null;

  return {
    uuid: payload.sub,
    name: '', // Will be resolved by caller if needed
    userId: payload.uid,
  };
}

export async function getProfileWithTextures(
  db: D1Database,
  profileUUID: string,
  unsigned: boolean = true,
  baseUrl?: string
): Promise<YggdrasilProfile | null> {
  const profile = await getProfileByUUID(db, profileUUID);
  if (!profile) return null;
  return buildProfileResponse(db, profile, unsigned, baseUrl);
}

export async function getProfileWithTexturesByName(
  db: D1Database,
  name: string,
  unsigned: boolean = true,
  baseUrl?: string
): Promise<YggdrasilProfile | null> {
  const profile = await getProfileByName(db, name);
  if (!profile) return null;
  return buildProfileResponse(db, profile, unsigned, baseUrl);
}

async function buildProfileResponse(
  db: D1Database,
  profile: PlayerProfile & { user_uuid: string; club: string | null },
  unsigned: boolean,
  baseUrl?: string
): Promise<YggdrasilProfile> {
  const properties: Array<{ name: string; value: string; signature?: string }> = [];

  const skin = profile.skin_texture_id ? await getTextureById(db, profile.skin_texture_id) : null;
  const cape = profile.cape_texture_id ? await getTextureById(db, profile.cape_texture_id) : null;

  const prefix = baseUrl ?? '';
  const textures: Record<
    string,
    {
      url: string;
      metadata?: { model?: 'slim' };
    }
  > = {};

  if (skin) {
    if (profile.model === 'slim') {
      textures.SKIN = {
        url: `${prefix}/textures/${skin.hash}`,
        metadata: { model: 'slim' },
      };
    } else {
      textures.SKIN = {
        url: `${prefix}/textures/${skin.hash}`,
      };
    }
  }

  if (cape) {
    textures.CAPE = {
      url: `${prefix}/textures/${cape.hash}`,
    };
  }

  const textureProp = {
    timestamp: Date.now(),
    profileId: toUndashedUUID(profile.uuid),
    profileName: profile.name,
    isPublic: true,
    signatureRequired: !unsigned,
    textures,
  };

  const textureValue = btoa(JSON.stringify(textureProp));
  properties.push({ name: 'textures', value: textureValue });
  properties.push({ name: 'uploadableTextures', value: 'skin,cape' });

  // Sign all properties when unsigned=false and a private key is configured
  if (!unsigned) {
    const privateKeyPem = await getUnionPrivateKey(db);
    if (privateKeyPem) {
      const encoder = new TextEncoder();
      for (const prop of properties) {
        const sig = await rsaPkcs1Sha256Sign(encoder.encode(prop.value), privateKeyPem);
        if (sig) {
          prop.signature = btoa(String.fromCharCode(...sig));
        }
      }
    }
  }

  const result: YggdrasilProfile = {
    id: toUndashedUUID(profile.uuid),
    name: profile.name,
    properties,
  };
  return result;
}
