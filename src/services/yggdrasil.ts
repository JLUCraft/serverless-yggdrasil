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
import { verifyPassword, generateUUID, signJWT, verifyJWT } from '../utils/crypto';

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
  const availableProfiles = profiles.map((p) => ({ id: p.uuid, name: p.name }));
  const selectedProfile = availableProfiles[0] ?? null;

  const clientToken = req.clientToken ?? generateUUID();
  const accessToken = await generateAccessToken(user, clientToken, secret);

  const result: {
    accessToken: string;
    clientToken: string;
    availableProfiles: Array<{ id: string; name: string }>;
    selectedProfile: { id: string; name: string } | null;
    user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
  } = {
    accessToken,
    clientToken,
    availableProfiles,
    selectedProfile,
  };

  if (req.requestUser) {
    result.user = {
      id: user.uuid,
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
      user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
    }
  | null
> {
  // Verify the old token to extract user info
  let user: User | null = null;
  let profile: PlayerProfile | null = null;

  if (req.accessToken) {
    const payload = await verifyJWT<{ sub: string; uid: number; clientToken: string }>(req.accessToken, secret);
    if (payload) {
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

  const clientToken = req.clientToken ?? generateUUID();
  const accessToken = await generateAccessToken(user, clientToken, secret);

  const result: {
    accessToken: string;
    clientToken: string;
    selectedProfile: { id: string; name: string } | null;
    user?: { id: string; username: string; properties: Array<{ name: string; value: string }> };
  } = {
    accessToken,
    clientToken,
    selectedProfile: profile ? { id: profile.uuid, name: profile.name } : null,
  };

  if (req.requestUser) {
    result.user = {
      id: user.uuid,
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
  profile: PlayerProfile & { user_uuid: string },
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
    profileId: profile.uuid,
    profileName: profile.name,
    signatureRequired: !unsigned,
    textures,
  };

  properties.push({
    name: 'textures',
    value: btoa(JSON.stringify(textureProp)),
  });

  return {
    id: profile.uuid,
    name: profile.name,
    properties,
  };
}
