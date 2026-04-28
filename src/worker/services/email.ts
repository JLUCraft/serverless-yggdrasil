import type { D1Database } from '@cloudflare/workers-types';
import type { EmailVerification, Env } from '../types';
import { generateToken } from '../utils/crypto';

interface Policy {
  recipient: string;
  tokenBytes: number;
  tokenChars: number;
  ttlSeconds: number;
}

function requiredInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function readPolicy(env: Pick<Env, 'EMAIL_VERIFICATION_RECIPIENT' | 'EMAIL_VERIFICATION_TOKEN_BYTES' | 'EMAIL_VERIFICATION_TTL_SECONDS'>): Policy {
  const recipient = env.EMAIL_VERIFICATION_RECIPIENT?.trim().toLowerCase();
  if (!recipient || !recipient.includes('@')) {
    throw new Error('EMAIL_VERIFICATION_RECIPIENT must be a valid mailbox');
  }

  const tokenBytes = requiredInteger('EMAIL_VERIFICATION_TOKEN_BYTES', env.EMAIL_VERIFICATION_TOKEN_BYTES);
  const ttlSeconds = requiredInteger('EMAIL_VERIFICATION_TTL_SECONDS', env.EMAIL_VERIFICATION_TTL_SECONDS);

  return {
    recipient,
    tokenBytes,
    tokenChars: tokenBytes * 2,
    ttlSeconds,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Generate a verification request for email suffix verification
export async function createEmailVerification(
  db: D1Database,
  email: string,
  tokenBytes: number,
  userId?: number
): Promise<EmailVerification> {
  const token = generateToken(tokenBytes);

  await db
    .prepare(
      `INSERT INTO email_verifications (email, verification_token, user_id)
       VALUES (?, ?, ?)`
    )
    .bind(normalizeEmail(email), token, userId ?? null)
    .run();

  const row = await db
    .prepare('SELECT * FROM email_verifications WHERE verification_token = ?')
    .bind(token)
    .first<EmailVerification>();

  if (!row) throw new Error('Failed to create email verification');
  return row;
}

export async function getEmailVerificationByToken(
  db: D1Database,
  token: string
): Promise<EmailVerification | null> {
  const row = await db
    .prepare('SELECT * FROM email_verifications WHERE verification_token = ?')
    .bind(token.toLowerCase())
    .first<EmailVerification>();
  return row ?? null;
}

export async function markEmailVerified(
  db: D1Database,
  tokenId: number,
  userId?: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE email_verifications
       SET status = 'verified', verified_at = unixepoch(), user_id = COALESCE(?, user_id)
       WHERE id = ?`
    )
    .bind(userId ?? null, tokenId)
    .run();
}

export async function markEmailExpired(
  db: D1Database,
  tokenId: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE email_verifications
       SET status = 'expired'
       WHERE id = ? AND status = 'pending'`
    )
    .bind(tokenId)
    .run();
}

export function isExpired(
  verification: Pick<EmailVerification, 'created_at'>,
  nowSeconds: number,
  ttlSeconds: number
): boolean {
  return verification.created_at + ttlSeconds < nowSeconds;
}

// Parse incoming email for verification
export function parseVerificationEmail(
  from: string,
  subject: string,
  body: string,
  tokenChars: number
): { email: string; token: string | null; valid: boolean } {
  // Extract sender email
  const emailMatch = from.match(/<?([^\u003e\s]+@[^\u003e\s]+)>?/);
  const email = normalizeEmail(emailMatch?.[1] ?? from);

  // Look for verification token in subject or body
  const tokenRegex = new RegExp(`(?<![a-f0-9])[a-f0-9]{${tokenChars}}(?![a-f0-9])`, 'i');
  const tokenMatch = subject.match(tokenRegex) ?? body.match(tokenRegex);
  const token = tokenMatch?.[0]?.toLowerCase() ?? null;

  return { email, token, valid: !!token };
}

// Extract domain from email
export function getEmailDomain(email: string): string | null {
  const match = normalizeEmail(email).match(/@(.+)$/);
  return match?.[1] ?? null;
}

// Validate email domain against allowed list
export function isAllowedDomain(email: string, allowedDomains: string[]): boolean {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return allowedDomains.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );
}
