import { createSignal } from 'solid-js';
import siteConfig from '../../../site.config.json'

const API_BASE = '';

export type Role = 'guest' | 'member' | 'admin';
export type TextureKind = 'skin' | 'cape';
export type Shape = 'default' | 'slim';

export type Texture = {
  uuid: string;
  hash: string;
  type: TextureKind;
  url: string;
};

export type Profile = {
  id: string;
  name: string;
  model: string;
  skin: Texture | null;
  cape: Texture | null;
};

export type User = {
  uuid: string;
  username: string;
  email: string | null;
  email_verified: boolean;
  role: Role;
  status: string;
  club: string | null;
  created_at: number;
  profiles: Array<Pick<Profile, 'id' | 'name' | 'model'>>;
};

export type Bridge = {
  site_code: string;
  site_name: string;
  api_key: string | null;
  union_endpoint: string;
  enabled: boolean;
};

export type Site = {
  site_code: string;
  site_name: string;
  endpoint: string;
  api_key?: string;
  enabled: boolean;
};

export const allowedEmailDomains: string[] = siteConfig.allowedEmailDomains;

export type Identity = Pick<User, 'username' | 'role'>;

const credentialSlot = 'token';
const [account, setIdentity] = createSignal<Identity | null>(null);
const [busy, setBusy] = createSignal(false);
let lookup: Promise<Identity | null> | null = null;

export { account, busy };

function identityFrom(user: Identity): Identity {
  return { username: user.username, role: user.role };
}

export function readCredential(): string | null {
  return localStorage.getItem(credentialSlot);
}

export function acceptLogin(token: string, user: Identity) {
  localStorage.setItem(credentialSlot, token);
  setIdentity(identityFrom(user));
}

export function forgetLogin() {
  localStorage.removeItem(credentialSlot);
  setIdentity(null);
}

export function authRejected(message: string | undefined): boolean {
  return Boolean(message?.includes('Unauthorized') || message?.includes('Invalid'));
}

export async function loadAccount(): Promise<Identity | null> {
  if (!readCredential()) {
    setIdentity(null);
    return null;
  }

  if (lookup) {
    return lookup;
  }

  setBusy(true);
  lookup = request<{ data: User }>('/api/auth/me')
    .then((res) => {
      const next = identityFrom(res.data);
      setIdentity(next);
      return next;
    })
    .catch(() => {
      forgetLogin();
      return null;
    })
    .finally(() => {
      lookup = null;
      setBusy(false);
    });

  return lookup;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  if (!(options.body instanceof FormData) && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = readCredential();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch((): Record<string, unknown> => ({}));

  if (!res.ok) {
    throw new Error(String(data.errorMessage || data.error || `HTTP ${res.status}`));
  }

  return data as T;
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<{ data: { token: string; user: { uuid: string; username: string; role: Role; email_verified: boolean } } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    registerInitiate: (username: string, email: string) =>
      request<{ data: { message: string; recipient: string; token: string; expires_in: number } }>('/api/auth/register/initiate', {
        method: 'POST',
        body: JSON.stringify({ username, email }),
      }),
    registerComplete: (username: string, password: string, email: string, verificationToken: string) =>
      request<{ data: { token: string; user: { uuid: string; username: string; role: Role; email_verified: boolean } } }>('/api/auth/register/complete', {
        method: 'POST',
        body: JSON.stringify({ username, password, email, verification_token: verificationToken }),
      }),
    register: (username: string, password: string, email: string) =>
      request<{ data: { token: string; user: { uuid: string; username: string; role: Role } } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, email }),
      }),
    me: async () => {
      const res = await request<{ data: User }>('/api/auth/me');
      setIdentity(identityFrom(res.data));
      return res;
    },
    verifyEmailRequest: (email: string) =>
      request<{ data: { message: string; recipient: string; token: string; expires_in: number } }>('/api/auth/verify-email/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
  },
  skin: {
    upload: (file: File, type: TextureKind) => {
      const form = new FormData();
      form.append('file', file);
      form.append('type', type);
      return request<{ data: Texture }>('/api/skin/upload', {
        method: 'POST',
        body: form,
      });
    },
    textures: () =>
      request<{ data: Texture[] }>('/api/skin/textures'),
    profiles: () =>
      request<{ data: Profile[] }>('/api/skin/profiles'),
    createProfile: (name: string, model: Shape) =>
      request<{ data: { id: string; name: string; model: string } }>('/api/skin/profiles', {
        method: 'POST',
        body: JSON.stringify({ name, model }),
      }),
    assignTextures: (profileId: string, body: { skin_texture_uuid?: string; cape_texture_uuid?: string; model?: Shape }) =>
      request<{ data: { updated: boolean } }>(`/api/skin/profiles/${profileId}/textures`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteTexture: (uuid: string) =>
      request<{ data: { deleted: boolean } }>(`/api/skin/textures/${uuid}`, { method: 'DELETE' }),
  },
  premium: {
    status: () =>
      request<{ data: { bound: boolean; minecraft_uuid?: string; minecraft_name?: string; bound_at?: number } }>('/api/premium/status'),
    bind: () =>
      request<{ data: { auth_url: string } }>('/api/premium/bind'),
    unbind: () =>
      request<{ data: { unbound: boolean } }>('/api/premium/unbind', { method: 'POST' }),
  },
  users: {
    list: () =>
      request<{ data: User[] }>('/api/admin/users'),
    changeRole: (userId: string, role: Role) =>
      request<{ data: { updated: boolean } }>(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
  },
  bridge: {
    read: () =>
      request<{ data: Bridge | null }>('/api/mua/config'),
    write: (body: Partial<Bridge>) =>
      request<{ data: Bridge }>('/api/mua/config', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    list: () =>
      request<{ data: Site[] }>('/api/mua/trusted-sites'),
    create: (body: Omit<Site, 'enabled'>) =>
      request<{ data: Site }>('/api/mua/trusted-sites', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  yggdrasil: {
    metadata: () =>
      request<Record<string, unknown>>('/'),
  },
};

export function logout() {
  forgetLogin();
  window.location.href = '/login';
}
