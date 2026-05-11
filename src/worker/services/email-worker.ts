/**
 * Cloudflare Email Worker handler.
 *
 * Processes incoming emails sent to the configured verification mailbox,
 * parsing tokens and marking email verifications as complete.
 *
 * This module is deliberately isolated from Hono route plumbing —
 * it is invoked directly by the Worker's `email()` export.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import {
  getEmailVerificationByToken,
  markEmailExpired,
  markEmailVerified,
  parseVerificationEmail,
  isAllowedDomain,
  isExpired,
  normalizeEmail,
  readPolicy,
} from './email';
import { getUserByEmail, updateUser } from './user';
import siteConfig from '../../../site.config.json';

export async function handleIncomingEmail(
  message: { from: string; to: string; headers: Headers; raw: ReadableStream | null },
  env: Env
): Promise<void> {
  const from = message.from;
  const to = normalizeEmail(message.to);
  const subject = message.headers.get('subject') ?? '';
  const policy = readPolicy(env);

  // Read email body
  let body = '';
  if (message.raw) {
    const raw = await new Response(message.raw).text();
    body = raw;
  }

  // Only process verification emails sent to the configured verification mailbox.
  if (to !== policy.recipient) {
    console.log(`Ignoring email to ${to}`);
    return;
  }

  const parsed = parseVerificationEmail(from, subject, body, policy.tokenChars);
  if (!parsed.valid || !parsed.token) {
    console.log(`Could not parse verification from email by ${from}`);
    return;
  }

  // Validate email domain
  if (!isAllowedDomain(parsed.email, siteConfig.allowedEmailDomains)) {
    console.log(`Email domain not allowed: ${parsed.email}`);
    return;
  }

  const db: D1Database = env.DB;

  // Find verification record
  const verification = await getEmailVerificationByToken(db, parsed.token);
  if (!verification || verification.status !== 'pending') {
    console.log(`Verification not found or already processed: ${parsed.token}`);
    return;
  }

  if (isExpired(verification, Math.floor(Date.now() / 1000), policy.ttlSeconds)) {
    await markEmailExpired(db, verification.id);
    console.log(`Verification expired: ${parsed.token}`);
    return;
  }

  // Check if token matches the email
  if (verification.email !== parsed.email) {
    console.log(`Email mismatch: expected ${verification.email}, got ${parsed.email}`);
    return;
  }

  const domain = parsed.email.split('@')[1];

  // Update user if linked
  if (verification.user_id) {
    const existing = await getUserByEmail(db, parsed.email);
    if (existing && existing.id !== verification.user_id) {
      console.log(`Email already registered: ${parsed.email}`);
      return;
    }
    await updateUser(db, verification.user_id, {
      email: parsed.email,
      email_verified: 1,
      email_domain: domain ?? null,
    });
    await markEmailVerified(db, verification.id, verification.user_id);
  } else {
    await markEmailVerified(db, verification.id);
  }

  console.log(`Email verified: ${parsed.email}`);
}
