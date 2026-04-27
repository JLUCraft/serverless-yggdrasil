import siteConfig from '../../site.config.ts'

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

export const allowedEmailDomains = siteConfig.allowedEmailDomains;

function getToken(): string | null {
  return localStorage.getItem('token');
}

let seed = 2;

let mockProfiles: Profile[] = [
  { id: 'prof-1', name: 'TestUser', model: 'default', skin: null, cape: null },
];

let mockTextures: Texture[] = [];

let mockUser: User = {
  uuid: 'mock-uuid-1234',
  username: 'testuser',
  email: 'test@jlu.edu.cn',
  email_verified: true,
  role: 'admin',
  status: 'active',
  club: 'JLUCraft',
  created_at: 1714156800,
  profiles: mockProfiles.map(({ id, name, model }) => ({ id, name, model })),
};

let mockUsers: User[] = [mockUser];

let mockBridge: Bridge = {
  site_code: siteConfig.shortName.toLowerCase(),
  site_name: siteConfig.siteSubtitle,
  api_key: null,
  union_endpoint: '',
  enabled: true,
};

let mockSites: Site[] = [];

const isMock = () => import.meta.env.DEV;

function syncMockUser() {
  mockUser = {
    ...mockUser,
    profiles: mockProfiles.map(({ id, name, model }) => ({ id, name, model })),
  };
  mockUsers = mockUsers.map((entry) => (entry.uuid === mockUser.uuid ? mockUser : entry));
}

function nextId(prefix: string): string {
  const value = seed;
  seed += 1;
  return `${prefix}-${value}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isMock()) {
    if (path === '/api/auth/me') {
      return { data: mockUser } as T;
    }
    if (path === '/api/skin/profiles' && (!options.method || options.method === 'GET')) {
      return { data: mockProfiles } as T;
    }
    if (path === '/api/skin/textures' && (!options.method || options.method === 'GET')) {
      return { data: mockTextures } as T;
    }
    if (path === '/api/skin/profiles' && options.method === 'POST') {
      const payload = JSON.parse(String(options.body ?? '{}')) as { name: string; model?: Shape };
      const profile: Profile = {
        id: nextId('prof'),
        name: payload.name,
        model: String(payload.model),
        skin: null,
        cape: null,
      };
      mockProfiles = [...mockProfiles, profile];
      syncMockUser();
      return { data: { id: profile.id, name: profile.name, model: profile.model } } as T;
    }
    if (path === '/api/skin/upload' && options.method === 'POST') {
      const form = options.body as FormData;
      const type = String(form.get('type')) as TextureKind;
      const texture: Texture = {
        uuid: nextId('tex'),
        hash: nextId('hash'),
        type,
        url: '/logo.png',
      };
      mockTextures = [texture, ...mockTextures];
      return { data: texture } as T;
    }
    if (path.startsWith('/api/skin/textures/') && options.method === 'DELETE') {
      const uuid = path.split('/').pop();
      const used = mockProfiles.some((entry) => entry.skin?.uuid === uuid || entry.cape?.uuid === uuid);
      if (used) {
        throw new Error('Texture is in use and cannot be deleted');
      }
      mockTextures = mockTextures.filter((texture) => texture.uuid !== uuid);
      return { data: { deleted: true } } as T;
    }
    if (path.startsWith('/api/skin/profiles/') && path.endsWith('/textures') && options.method === 'POST') {
      const profileId = path.split('/')[4];
      const payload = JSON.parse(String(options.body ?? '{}')) as {
        skin_texture_uuid?: string;
        cape_texture_uuid?: string;
        model?: Shape;
      };
      mockProfiles = mockProfiles.map((entry) => {
        if (entry.id !== profileId) {
          return entry;
        }
        const skin = payload.skin_texture_uuid
          ? mockTextures.find((texture) => texture.uuid === payload.skin_texture_uuid)
          : undefined;
        const cape = payload.cape_texture_uuid
          ? mockTextures.find((texture) => texture.uuid === payload.cape_texture_uuid)
          : undefined;
        if (payload.skin_texture_uuid && !skin) {
          throw new Error('Invalid skin texture');
        }
        if (payload.cape_texture_uuid && !cape) {
          throw new Error('Invalid cape texture');
        }
        return {
          ...entry,
          model: payload.model ?? entry.model,
          skin: skin ?? entry.skin,
          cape: cape ?? entry.cape,
        };
      });
      syncMockUser();
      return { data: { updated: true } } as T;
    }
    if (path === '/api/premium/status') {
      return { data: { bound: false } } as T;
    }
    if (path === '/api/admin/users') {
      return { data: mockUsers } as T;
    }
    if (path.startsWith('/api/admin/users/') && options.method === 'PATCH') {
      const userId = path.split('/').pop();
      const payload = JSON.parse(String(options.body ?? '{}')) as { role: Role };
      mockUsers = mockUsers.map((entry) => (entry.uuid === userId ? { ...entry, role: payload.role } : entry));
      mockUser = mockUsers.find((entry) => entry.uuid === mockUser.uuid) ?? mockUser;
      return { data: { updated: true } } as T;
    }
    if (path === '/api/mua/config' && (!options.method || options.method === 'GET')) {
      return { data: mockBridge } as T;
    }
    if (path === '/api/mua/config' && options.method === 'PATCH') {
      const payload = JSON.parse(String(options.body ?? '{}')) as Partial<Bridge>;
      mockBridge = { ...mockBridge, ...payload };
      return { data: mockBridge } as T;
    }
    if (path === '/api/mua/trusted-sites' && (!options.method || options.method === 'GET')) {
      return { data: mockSites } as T;
    }
    if (path === '/api/mua/trusted-sites' && options.method === 'POST') {
      const payload = JSON.parse(String(options.body ?? '{}')) as Omit<Site, 'enabled'>;
      const site: Site = { ...payload, enabled: true };
      mockSites = [...mockSites, site];
      return { data: site } as T;
    }
  }

  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  if (!(options.body instanceof FormData) && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.errorMessage || data.error || `HTTP ${res.status}`);
  }

  return data as T;
}

export const api = {
  auth: {
    login: (username: string, password: string) => {
      if (isMock()) {
        localStorage.setItem('token', 'mock-token');
        return Promise.resolve({ data: { token: 'mock-token', user: mockUser } });
      }
      return request<{ data: { token: string; user: { uuid: string; username: string; role: string; email_verified: boolean } } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    },
    registerInitiate: (username: string, password: string, email: string) => {
      if (isMock()) {
        return Promise.resolve({
          data: {
            message: `Please send an email to verify@${siteConfig.siteDomain} with token`,
            recipient: `verify@${siteConfig.siteDomain}`,
            token: crypto.randomUUID().replaceAll('-', ''),
            expires_in: 86400,
          },
        });
      }
      return request<{ data: { message: string; recipient: string; token: string; expires_in: number } }>('/api/auth/register/initiate', {
        method: 'POST',
        body: JSON.stringify({ username, password, email }),
      });
    },
    registerComplete: (username: string, password: string, email: string, verificationToken: string) => {
      if (isMock()) {
        localStorage.setItem('token', 'mock-token');
        return Promise.resolve({ data: { token: 'mock-token', user: mockUser } });
      }
      return request<{ data: { token: string; user: { uuid: string; username: string; role: string; email_verified: boolean } } }>('/api/auth/register/complete', {
        method: 'POST',
        body: JSON.stringify({ username, password, email, verification_token: verificationToken }),
      });
    },
    register: (username: string, password: string, email: string) => {
      if (isMock()) {
        localStorage.setItem('token', 'mock-token');
        return Promise.resolve({ data: { token: 'mock-token', user: mockUser } });
      }
      return request<{ data: { token: string; user: { uuid: string; username: string; role: string } } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, email }),
      });
    },
    me: () =>
      request<{ data: User }>('/api/auth/me'),
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
  localStorage.removeItem('token');
  window.location.href = '/login';
}
