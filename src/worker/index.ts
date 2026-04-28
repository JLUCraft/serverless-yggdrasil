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
import unionRoutes from './routes/union';

import { getEmailVerificationByToken, markEmailExpired, markEmailVerified, parseVerificationEmail, isAllowedDomain, isExpired, normalizeEmail, readPolicy } from './services/email';
import { getUserByEmail, updateUser } from './services/user';
import { ConfigurationError } from './services/security';
import siteConfig from '../../site.config.json';
import { initDatabase } from './services/db-init';
import { error } from './utils/response';
import { strictRateLimit, standardRateLimit } from './middleware/rate-limit';

const app = new Hono<{ Bindings: Env }>();
const YGGDRASIL_PATH = '/api/yggdrasil';

app.onError((err) => {
  if (err instanceof ConfigurationError) {
    return error(err.message, 500);
  }

  console.error(err);
  return error('Internal server error', 500);
});

function getBaseUrl(c: import('hono').Context<{ Bindings: Env }>): string {
  const host = c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

function addAliHeader(c: import('hono').Context<{ Bindings: Env }>, response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set('X-Authlib-Injector-API-Location', `${getBaseUrl(c)}${YGGDRASIL_PATH}`);
  return next;
}

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

// Mount routes with rate limiting
app.use('/api/auth/*', strictRateLimit);
app.route('/api/auth', authRoutes);

app.use('/api/skin/*', standardRateLimit);
app.route('/api/skin', skinRoutes);

app.use('/api/mua/*', standardRateLimit);
app.route('/api/mua', muaRoutes);

app.use('/api/admin/*', standardRateLimit);
app.route('/api/admin', adminRoutes);

app.use('/api/premium/*', standardRateLimit);
app.route('/api/premium', premiumRoutes);

app.use('/api/union/*', standardRateLimit);
app.route('/api/union', unionRoutes);

app.use(`${YGGDRASIL_PATH}/*`, strictRateLimit);
app.route(YGGDRASIL_PATH, yggdrasilRoutes);

// Public Yggdrasil texture endpoint.
app.get('/textures/:hash', async (c) => {
  const hash = c.req.param('hash');
  const data = await c.env.SKINS.get(`textures/${hash}`);
  if (!data) {
    return new Response(null, { status: 404 });
  }

  return new Response(data.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
});

// Serve frontend SPA (fallback to static assets)
app.get('/*', async (c) => {
  return addAliHeader(c, await c.env.ASSETS.fetch(c.req.raw));
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
