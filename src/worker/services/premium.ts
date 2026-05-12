import type { D1Database } from '@cloudflare/workers-types';

export interface PremiumBinding {
  id: number;
  user_id: number;
  microsoft_uuid: string;
  minecraft_uuid: string;
  minecraft_name: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  verified: number;
  created_at: number;
  updated_at: number;
}

export interface MicrosoftProfile {
  id: string;
  name: string;
  microsoft_uuid: string;
}



export async function exchangeMicrosoftCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const resp = await fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return data;
}



export async function authenticateXboxLive(accessToken: string): Promise<{ token: string; uhs: string } | null> {
  const resp = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${accessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    Token: string;
    DisplayClaims: { xui: Array<{ uhs: string }> };
  };

  const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
  if (!uhs) return null;
  return { token: data.Token, uhs };
}



export async function authenticateXSTS(xboxToken: string): Promise<{ token: string; uhs: string } | null> {
  const resp = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xboxToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    Token: string;
    DisplayClaims: { xui: Array<{ uhs: string }> };
  };

  const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
  if (!uhs) return null;
  return { token: data.Token, uhs };
}



export async function authenticateMinecraft(xstsToken: string, uhs: string): Promise<string | null> {
  const resp = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
    }),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as { access_token: string };
  return data.access_token ?? null;
}



export async function getMinecraftProfile(minecraftAccessToken: string): Promise<{ id: string; name: string } | null> {
  const resp = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: {
      Authorization: `Bearer ${minecraftAccessToken}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as { id: string; name: string };
  if (!data.id || !data.name) return null;
  return data;
}



export async function verifyMicrosoftAccount(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<MicrosoftProfile | null> {

  const msToken = await exchangeMicrosoftCode(code, clientId, clientSecret, redirectUri);
  if (!msToken) return null;


  const xbox = await authenticateXboxLive(msToken.access_token);
  if (!xbox) return null;


  const xsts = await authenticateXSTS(xbox.token);
  if (!xsts) return null;


  const mcToken = await authenticateMinecraft(xsts.token, xsts.uhs);
  if (!mcToken) return null;


  const profile = await getMinecraftProfile(mcToken);
  if (!profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    microsoft_uuid: xsts.uhs,
  };
}



export async function getPremiumBindingByUser(db: D1Database, userId: number): Promise<PremiumBinding | null> {
  const row = await db
    .prepare('SELECT * FROM premium_bindings WHERE user_id = ?')
    .bind(userId)
    .first<PremiumBinding>();
  return row ?? null;
}

export async function getPremiumBindingByMinecraftUUID(db: D1Database, minecraftUuid: string): Promise<PremiumBinding | null> {
  const row = await db
    .prepare('SELECT * FROM premium_bindings WHERE minecraft_uuid = ?')
    .bind(minecraftUuid)
    .first<PremiumBinding>();
  return row ?? null;
}

export async function createPremiumBinding(
  db: D1Database,
  userId: number,
  profile: MicrosoftProfile,
  tokens?: { access_token: string; refresh_token: string; expires_in: number }
): Promise<PremiumBinding> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO premium_bindings
       (user_id, microsoft_uuid, minecraft_uuid, minecraft_name, access_token, refresh_token, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         microsoft_uuid = excluded.microsoft_uuid,
         minecraft_uuid = excluded.minecraft_uuid,
         minecraft_name = excluded.minecraft_name,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at,
         verified = 1`
    )
    .bind(
      userId,
      profile.microsoft_uuid,
      profile.id,
      profile.name,
      tokens?.access_token ?? null,
      tokens?.refresh_token ?? null,
      tokens ? now + tokens.expires_in : null,
      now
    )
    .run();

  const binding = await getPremiumBindingByUser(db, userId);
  if (!binding) throw new Error('Failed to create premium binding');
  return binding;
}

export async function deletePremiumBinding(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM premium_bindings WHERE user_id = ?').bind(userId).run();
}


export async function isPremiumPlayer(db: D1Database, minecraftUuid: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM premium_bindings WHERE minecraft_uuid = ? AND verified = 1')
    .bind(minecraftUuid)
    .first<{ id: number }>();
  return row !== null;
}
