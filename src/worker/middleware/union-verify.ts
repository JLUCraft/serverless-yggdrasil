import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { rsaPkcs1Sha256Verify, base64ToBytes } from '../utils/crypto';
import { getUnionPublicKey } from '../services/union';
import { joinEndpoint } from '../services/mua';
import { error } from '../utils/response';

async function fetchUnionPublicKey(unionEndpoint: string): Promise<string | null> {
  try {
    const root = joinEndpoint(unionEndpoint);

    const structuredResp = await fetch(`${root}/pubkey`);
    if (structuredResp.ok) {
      const contentType = structuredResp.headers.get('content-type') ?? '';
      if (contentType.includes('json')) {
        const data = (await structuredResp.json()) as { public_key_pem?: string };
        if (data.public_key_pem) return data.public_key_pem;
      }
    }


    const resp = await fetch(`${root}/`);
    if (!resp.ok) return null;
    const text = await resp.text();
    const match = text.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export const unionVerifyMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const signatureB64 = c.req.header('X-Message-Signature');
  const timestamp = c.req.header('X-Message-Timestamp');
  const nonce = c.req.header('X-Message-Nonce');

  if (!signatureB64 || !timestamp || !nonce) {
    return error('Missing union signature headers', 403);
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return error('Invalid timestamp', 403);
  }

  const now = Math.floor(Date.now() / 1000);
  if (ts < now - 10 || ts > now + 30) {
    return error('Timestamp out of range', 403);
  }

  const nonceKey = `union_nonce:${nonce}`;
  const existingNonce = await c.env.KV.get(nonceKey);
  if (existingNonce) {
    return error('Replay attack detected', 403);
  }
  await c.env.KV.put(nonceKey, '1', { expirationTtl: 60 });

  let signature: Uint8Array;
  try {
    signature = base64ToBytes(signatureB64);
  } catch {
    return error('Invalid signature encoding', 403);
  }

  let publicKey = await getUnionPublicKey(c.env.DB);
  if (!publicKey) {
    const unionEndpoint = c.env.MUA_UNION_ENDPOINT;
    if (!unionEndpoint) {
      return error('Union endpoint not configured', 500);
    }
    publicKey = await fetchUnionPublicKey(unionEndpoint);
    if (!publicKey) {
      return error('Cannot fetch union public key for verification', 503);
    }
  }

  const cloned = c.req.raw.clone();
  const body = await cloned.text();
  const message = new TextEncoder().encode(`${body}${timestamp}${nonce}`);

  const valid = await rsaPkcs1Sha256Verify(message, signature, publicKey);
  if (!valid) {
    return error('Invalid union signature', 403);
  }

  await next();
  return undefined;
};
