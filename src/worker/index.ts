import { Hono } from 'hono';
import type { Env } from './types';
import { success, error, pngResponse } from './utils/response';
import { getBaseUrl } from './utils/request';

import authRoutes from './routes/auth';
import skinRoutes from './routes/skin';
import yggdrasilRoutes from './routes/yggdrasil';
import muaRoutes from './routes/mua';
import adminRoutes from './routes/admin';
import premiumRoutes from './routes/premium';
import unionRoutes from './routes/union';
import protoStationRoutes from './routes/proto-station';

import { ConfigurationError } from './services/security';
import { handleIncomingEmail } from './services/email-worker';
import { initDatabase } from './services/db-init';
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

function addAliHeader(c: import('hono').Context<{ Bindings: Env }>, response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set('X-Authlib-Injector-API-Location', `${getBaseUrl(c)}${YGGDRASIL_PATH}`);
  return next;
}

app.use(async (c, next) => {
  await initDatabase(c.env.DB);
  await next();
});

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:1420',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:1420',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function getAllowedOrigins(env: Env): string[] {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

app.use('*', async (c, next) => {
  const allowed = getAllowedOrigins(c.env);
  const requestOrigin = c.req.header('origin');
  const isAllowed = requestOrigin ? allowed.includes(requestOrigin) : false;

  if (c.req.method === 'OPTIONS') {
    const resp = new Response(null, { status: 204 });
    if (isAllowed && requestOrigin) {
      resp.headers.set('Access-Control-Allow-Origin', requestOrigin);
    }
    resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    resp.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MUA-API-Key, X-Message-Signature, X-Message-Timestamp, X-Message-Nonce');
    resp.headers.set('Access-Control-Max-Age', '86400');
    return resp;
  }

  await next();

  if (isAllowed && requestOrigin) {
    c.res.headers.set('Access-Control-Allow-Origin', requestOrigin);
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MUA-API-Key, X-Message-Signature, X-Message-Timestamp, X-Message-Nonce');
    c.res.headers.set('Access-Control-Max-Age', '86400');
  }
  return c.res;
});

app.get('/health', (_c) => success({ status: 'ok', version: '1.0.0' }));

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

app.use('/rpc/*', standardRateLimit);
app.route('/rpc', protoStationRoutes);

app.get('/textures/:hash', async (c) => {
  const hash = c.req.param('hash');
  const data = await c.env.SKINS.get(`textures/${hash}`);
  if (!data) {
    return new Response(null, { status: 404 });
  }

  return pngResponse(await data.arrayBuffer());
});

app.get('/*', async (c) => {
  return addAliHeader(c, await c.env.ASSETS.fetch(c.req.raw));
});

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, _ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleIncomingEmail(message, env);
  },
};