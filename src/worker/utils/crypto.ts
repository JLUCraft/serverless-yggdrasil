import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

export function generateUUID(): string {
  const buf = randomBytes(16);
  buf[6] = (buf[6]! & 0x0f) | 0x40;
  buf[8] = (buf[8]! & 0x3f) | 0x80;
  const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function toUndashedUUID(uuid: string): string {
  return uuid.replace(/-/g, '');
}

export function normalizeUUID(uuid: string): string {
  if (uuid.length === 32) {
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20, 32)}`;
  }
  return uuid;
}

export function hashTexture(data: ArrayBuffer): string {
  return bytesToHex(sha256(new Uint8Array(data)));
}

export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const s = salt ?? randomBytes(16);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: s, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hash = Array.from(new Uint8Array(derived), b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(s, b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:sha256:100000$${saltHex}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = new Uint8Array(parts[1]!.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const hashed = await hashPassword(password, salt);
  return hashed === stored;
}

export async function signJWT(payload: object, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret.trim());
  if (secretBytes.length === 0) {
    throw new Error('JWT_SECRET must be configured');
  }

  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${sigBase64}`;
}

export async function verifyJWT<T>(token: string, secret: string): Promise<T | null> {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const data = `${header}.${body}`;
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
    if (!valid) return null;

    const payload = JSON.parse(atob(body)) as T;
    return payload;
  } catch {
    return null;
  }
}

export function generateToken(byteLength: number): string {
  return bytesToHex(randomBytes(byteLength));
}

/**
 * Deterministic internal_id from UUID for MUA mapped profile responses.
 * Used for data privacy — masks the real UUID behind a stable integer.
 */
export function hashUUIDToInternalId(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = ((hash << 5) - hash) + uuid.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

export function validateEd25519KeyPair(publicKeyBase64: string, signatureBase64: string): { publicKey: Uint8Array; signature: Uint8Array } {
  let publicKey: Uint8Array;
  let signature: Uint8Array;
  try {
    publicKey = base64ToBytes(publicKeyBase64);
    signature = base64ToBytes(signatureBase64);
  } catch {
    throw new Error('Invalid base64 encoding for public_key or signature');
  }
  if (publicKey.length !== 32) {
    throw new Error('Invalid ed25519 public key length');
  }
  if (signature.length !== 64) {
    throw new Error('Invalid ed25519 signature length');
  }
  return { publicKey, signature };
}

export async function ed25519Verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      publicKey,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify('Ed25519', key, signature, message);
  } catch {
    return false;
  }
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/-----BEGIN RSA PUBLIC KEY-----/, '')
    .replace(/-----END RSA PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  return base64ToBytes(b64);
}

export async function rsaPkcs1Sha256Verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKeyPem: string
): Promise<boolean> {
  try {
    const der = pemToDer(publicKeyPem);
    const key = await crypto.subtle.importKey(
      'spki',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, message);
  } catch {
    return false;
  }
}

function pemPrivateToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  return base64ToBytes(b64);
}

export async function rsaPkcs1Sha256Sign(
  message: Uint8Array,
  privateKeyPem: string
): Promise<Uint8Array | null> {
  try {
    const der = pemPrivateToDer(privateKeyPem);
    // Try PKCS#8 first, then PKCS#1
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey(
        'pkcs8',
        der,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );
    } catch {
      // Cloudflare Workers may not support PKCS#1 raw import;
      // consumers should supply PKCS#8 formatted keys.
      return null;
    }
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, message);
    return new Uint8Array(sig);
  } catch {
    return null;
  }
}
