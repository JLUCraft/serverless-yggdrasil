import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { success } from './utils/response';

import authRoutes from './routes/auth';
import skinRoutes from './routes/skin';
import yggdrasilRoutes from './routes/yggdrasil';
import muaRoutes from './routes/mua';
import adminRoutes from './routes/admin';
import premiumRoutes from './routes/premium';

import { getEmailVerificationByToken, markEmailExpired, markEmailVerified, parseVerificationEmail, isAllowedDomain, isExpired, normalizeEmail, readPolicy } from './services/email';
import { getUserByEmail, updateUser } from './services/user';
import { siteConfig } from './config';
import { initDatabase } from './services/db-init';

const app = new Hono<{ Bindings: Env }>();

// Auto-init database on first request
app.use(async (c, next) => {
  await initDatabase(c.env.DB);
  await next();
});

// CORS
app.use(cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Health check
app.get('/health', (_c) => success({ status: 'ok', version: '1.0.0' }));

// Mount routes
app.route('/api/auth', authRoutes);
app.route('/api/skin', skinRoutes);
app.route('/api/mua', muaRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/premium', premiumRoutes);
app.route('/', yggdrasilRoutes); // Yggdrasil root routes

// Serve frontend SPA (fallback to static assets)
app.get('/*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// Email Worker handler
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, _ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
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

    const db = env.DB;

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
  },
};
