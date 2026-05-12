import { Hono } from 'hono';
import type { Context } from 'hono';
import { fromBinary, toBinary, create } from '@bufbuild/protobuf';
import {
  StationRequestSchema,
  StationReplySchema,
  ErrorSchema,
  SessionSchema,
  UserSchema,
  PlayerProfileSchema,
  EmailChallengeSchema,
} from '../proto/skin_station_pb.ts';
import type { StationRequest, StationReply, User } from '../proto/skin_station_pb.ts';
import type { Env } from '../types';
import * as userService from '../services/user';
import * as emailService from '../services/email';
import { authenticate as yggServiceAuthenticate } from '../services/yggdrasil';
import { readJwtSecret } from '../services/security';
import { verifyPassword, verifyJWT } from '../utils/crypto';
import { getClientIP } from '../utils/request';
import { logAuthEvent } from '../services/auth-log';
import { storeAccessToken } from '../middleware/auth';
import { createToken } from './auth';
import siteConfig from '../../../site.config.json';

const app = new Hono<{ Bindings: Env }>();





app.post('/', async (c) => {
  const buf = await c.req.arrayBuffer();
  let request: StationRequest;
  try {
    request = fromBinary(StationRequestSchema, new Uint8Array(buf));
  } catch {
    const reply = create(StationReplySchema, {
      requestId: '',
      error: create(ErrorSchema, { code: 'PARSE_ERROR', message: 'Failed to parse StationRequest' }),
    });
    return new Response(toBinary(StationReplySchema, reply), {
      status: 400,
      headers: { 'Content-Type': 'application/x-protobuf' },
    });
  }

  const reply = await dispatch(request, c.env, c);
  return new Response(toBinary(StationReplySchema, reply), {
    headers: { 'Content-Type': 'application/x-protobuf' },
  });
});





async function dispatch(
  req: StationRequest,
  env: Env,
  c: Context<{ Bindings: Env }>,
): Promise<StationReply> {
  const rid = req.requestId;
  try {
    switch (req.body.case) {

      case 'login':
        return handleLogin(rid, req.body.value, env, c);
      case 'currentUser':
        return handleCurrentUser(rid, env, c);


      case 'yggAuthenticate':
        return handleYggAuthenticate(rid, req.body.value, env, c);


      case 'registerStart':
        return handleRegisterStart(rid, req.body.value, env);
      case 'registerFinish':
        return handleRegisterFinish(rid, req.body.value, env, c);
      case 'emailVerify':
        return handleEmailVerify(rid, req.body.value, env);

      default:
        return errReply(rid, 'UNIMPLEMENTED', `${req.body.case} is not yet implemented over protobuf`);
    }
  } catch (err) {
    return errReply(rid, 'INTERNAL', err instanceof Error ? err.message : 'Internal server error');
  }
}





async function handleLogin(
  rid: string,
  body: { username: string; password: string },
  env: Env,
  c: Context<{ Bindings: Env }>,
): Promise<StationReply> {
  const db = env.DB;
  const ip = getClientIP(c);
  const ua = c.req.header('User-Agent') ?? undefined;

  if (!body.username || !body.password) {
    await logAuthEvent(db, { event_type: 'login_failure', username: body.username, ip_address: ip, user_agent: ua, details: 'Missing credentials' });
    return errReply(rid, 'BAD_REQUEST', 'Username and password are required');
  }

  const user = await userService.getUserByUsername(db, body.username);
  if (!user || !user.password_hash) {
    await logAuthEvent(db, { event_type: 'login_failure', username: body.username, ip_address: ip, user_agent: ua, details: 'User not found' });
    return errReply(rid, 'AUTH_FAILED', 'Invalid credentials');
  }

  if (user.status !== 'active') {
    await logAuthEvent(db, { event_type: 'login_failure', user_id: user.id, username: user.username, ip_address: ip, user_agent: ua, details: `Account status: ${user.status}` });
    return errReply(rid, 'FORBIDDEN', 'Account is suspended or banned');
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    await logAuthEvent(db, { event_type: 'login_failure', user_id: user.id, username: user.username, ip_address: ip, user_agent: ua, details: 'Invalid password' });
    return errReply(rid, 'AUTH_FAILED', 'Invalid credentials');
  }

  const secret = readJwtSecret(env);
  const now = Math.floor(Date.now() / 1000);

  const [token] = await Promise.all([
    createToken(secret, user),
    userService.updateUser(db, user.id, { last_login_at: now }),
  ]);

  logAuthEvent(db, { event_type: 'login_success', user_id: user.id, username: user.username, ip_address: ip, user_agent: ua });

  return sessionReply(rid, token, dbUserToProtoUser(user));
}

async function handleCurrentUser(
  rid: string,
  env: Env,
  c: Context<{ Bindings: Env }>,
): Promise<StationReply> {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return errReply(rid, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
  }

  const token = header.slice(7);
  const payload = await verifyJWT<{ sub: string; uid: number; role: string; exp: number }>(token, env.JWT_SECRET);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return errReply(rid, 'UNAUTHORIZED', 'Invalid or expired token');
  }

  const db = env.DB;
  const user = await userService.getUserById(db, payload.uid);
  if (!user || user.uuid !== payload.sub) {
    return errReply(rid, 'UNAUTHORIZED', 'User not found');
  }
  if (user.status !== 'active') {
    return errReply(rid, 'FORBIDDEN', 'Account is suspended or banned');
  }

  const profiles = await userService.getPlayerProfiles(db, user.id);

  return create(StationReplySchema, {
    requestId: rid,
    body: {
      case: 'user',
      value: dbUserToProtoUser(user, profiles),
    },
  });
}





async function handleYggAuthenticate(
  rid: string,
  body: { username: string; password: string; clientToken: string; requestUser: boolean },
  env: Env,
  c: Context<{ Bindings: Env }>,
): Promise<StationReply> {
  const ip = getClientIP(c);
  const ua = c.req.header('User-Agent') ?? undefined;

  const result = await yggServiceAuthenticate(env.DB, body, readJwtSecret(env));
  if (!result) {
    await logAuthEvent(env.DB, { event_type: 'login_failure', username: body.username, ip_address: ip, user_agent: ua, details: 'Yggdrasil proto authenticate failed' });
    return errReply(rid, 'AUTH_FAILED', 'Invalid credentials');
  }

  const { _userId: userId, ...publicResult } = result;

  await storeAccessToken(c, result.accessToken, {
    uuid: result.selectedProfile?.id ?? '',
    name: result.selectedProfile?.name ?? '',
    userId,
  });

  logAuthEvent(env.DB, { event_type: 'login_success', username: body.username, ip_address: ip, user_agent: ua, details: 'Yggdrasil proto authenticate' });

  const profileId = publicResult.selectedProfile?.id ?? '';
  const profileName = publicResult.selectedProfile?.name ?? body.username;

  return sessionReply(rid, result.accessToken, create(UserSchema, {
    uuid: profileId,
    username: profileName,
    role: '',
    status: 'active',
    email: '',
    emailVerified: false,
    emailDomain: '',
    club: '',
    peerId: '',
    createdAt: 0n,
    minecraftUuid: profileId,
    minecraftName: publicResult.selectedProfile?.name ?? '',
  }));
}





async function handleRegisterStart(
  rid: string,
  body: { username: string; email: string },
  env: Env,
): Promise<StationReply> {
  if (!body.username || !body.email) {
    return errReply(rid, 'BAD_REQUEST', 'Username and email are required');
  }

  if (body.username.length < 3 || body.username.length > 16) {
    return errReply(rid, 'BAD_REQUEST', 'Username must be 3-16 characters');
  }

  const db = env.DB;
  const existingUser = await userService.getUserByUsername(db, body.username);
  if (existingUser) {
    return errReply(rid, 'CONFLICT', 'Username already taken');
  }

  const email = emailService.normalizeEmail(body.email);
  const policy = emailService.readPolicy(env);
  const domain = emailService.getEmailDomain(email);
  if (!domain || !emailService.isAllowedDomain(email, siteConfig.allowedEmailDomains)) {
    return errReply(rid, 'BAD_REQUEST', `Email domain not allowed. Allowed: ${siteConfig.allowedEmailDomains.join(', ')}`);
  }

  const existingEmail = await userService.getUserByEmail(db, email);
  if (existingEmail) {
    return errReply(rid, 'CONFLICT', 'Email already registered');
  }

  const verification = await emailService.createEmailVerification(db, email, policy.tokenBytes);

  return create(StationReplySchema, {
    requestId: rid,
    body: {
      case: 'emailChallenge',
      value: create(EmailChallengeSchema, {
        message: `Please send an email from ${email} to ${policy.recipient} with subject containing token: ${verification.verification_token}`,
        recipient: policy.recipient,
        token: verification.verification_token,
        expiresIn: BigInt(policy.ttlSeconds),
      }),
    },
  });
}

async function handleRegisterFinish(
  rid: string,
  body: { username: string; password: string; email: string; verificationToken: string },
  env: Env,
  c: Context<{ Bindings: Env }>,
): Promise<StationReply> {
  if (!body.username || !body.password || !body.email || !body.verificationToken) {
    return errReply(rid, 'BAD_REQUEST', 'Username, password, email, and verification_token are required');
  }

  if (body.password.length < 8) {
    return errReply(rid, 'BAD_REQUEST', 'Password must be at least 8 characters');
  }

  const secret = readJwtSecret(env);
  const db = env.DB;

  const verification = await emailService.getEmailVerificationByToken(db, body.verificationToken);
  if (!verification) {
    return errReply(rid, 'BAD_REQUEST', 'Invalid verification token');
  }

  const policy = emailService.readPolicy(env);
  if (emailService.isExpired(verification, Math.floor(Date.now() / 1000), policy.ttlSeconds)) {
    await emailService.markEmailExpired(db, verification.id);
    return errReply(rid, 'BAD_REQUEST', 'Verification token expired');
  }

  const email = emailService.normalizeEmail(body.email);
  if (verification.status !== 'verified') {
    return errReply(rid, 'BAD_REQUEST', 'Email not verified yet');
  }
  if (verification.email !== email) {
    return errReply(rid, 'BAD_REQUEST', 'Verification token does not match the provided email');
  }

  const domain = emailService.getEmailDomain(email);
  if (!domain) {
    return errReply(rid, 'BAD_REQUEST', 'Invalid email domain');
  }

  const existingUser = await userService.getUserByUsername(db, body.username);
  const existingEmail = await userService.getUserByEmail(db, email);

  if (existingUser || existingEmail) {
    if (!existingUser || !existingEmail || existingUser.id !== existingEmail.id || existingUser.email !== email) {
      if (existingUser) return errReply(rid, 'CONFLICT', 'Username already taken');
      return errReply(rid, 'CONFLICT', 'Email already registered');
    }


    if (!existingUser.password_hash || !(await verifyPassword(body.password, existingUser.password_hash))) {
      return errReply(rid, 'CONFLICT', 'Username already taken');
    }

    const profile = await userService.getProfileByName(db, body.username);
    if (!profile) {
      await userService.createPlayerProfile(db, existingUser.id, body.username);
    } else if (profile.user_uuid !== existingUser.uuid) {
      return errReply(rid, 'CONFLICT', 'Profile name already taken');
    }

    const [token] = await Promise.all([
      createToken(secret, existingUser),
      userService.updateUser(db, existingUser.id, { email_verified: 1, email_domain: domain }),
      emailService.markEmailVerified(db, verification.id, existingUser.id),
    ]);

    return sessionReply(rid, token, dbUserToProtoUser(existingUser));
  }


  const user = await userService.createUser(db, {
    username: body.username,
    password: body.password,
    email,
    role: 'guest',
  });

  const [token] = await Promise.all([
    createToken(secret, user),
    userService.updateUser(db, user.id, { email_verified: 1, email_domain: domain }),
    userService.createPlayerProfile(db, user.id, body.username),
    emailService.markEmailVerified(db, verification.id, user.id),
  ]);

  logAuthEvent(db, { event_type: 'register', user_id: user.id, username: user.username, ip_address: getClientIP(c), user_agent: c.req.header('User-Agent') ?? undefined });

  return sessionReply(rid, token, dbUserToProtoUser(user));
}

async function handleEmailVerify(
  rid: string,
  body: { email: string },
  env: Env,
): Promise<StationReply> {
  if (!body.email) {
    return errReply(rid, 'BAD_REQUEST', 'Email is required');
  }

  const email = emailService.normalizeEmail(body.email);
  const policy = emailService.readPolicy(env);
  const domain = emailService.getEmailDomain(email);
  if (!domain || !emailService.isAllowedDomain(email, siteConfig.allowedEmailDomains)) {
    return errReply(rid, 'BAD_REQUEST', `Email domain not allowed. Allowed: ${siteConfig.allowedEmailDomains.join(', ')}`);
  }

  const db = env.DB;
  const existingEmail = await userService.getUserByEmail(db, email);
  if (existingEmail) {
    return errReply(rid, 'CONFLICT', 'Email already registered');
  }

  const verification = await emailService.createEmailVerification(db, email, policy.tokenBytes);

  return create(StationReplySchema, {
    requestId: rid,
    body: {
      case: 'emailChallenge',
      value: create(EmailChallengeSchema, {
        message: `Please send an email from ${email} to ${policy.recipient} with subject containing token: ${verification.verification_token}`,
        recipient: policy.recipient,
        token: verification.verification_token,
        expiresIn: BigInt(policy.ttlSeconds),
      }),
    },
  });
}





function errReply(rid: string, code: string, message: string): StationReply {
  return create(StationReplySchema, {
    requestId: rid,
    error: create(ErrorSchema, { code, message }),
  });
}

function sessionReply(rid: string, token: string, user: User): StationReply {
  return create(StationReplySchema, {
    requestId: rid,
    body: {
      case: 'session',
      value: create(SessionSchema, { token, user }),
    },
  });
}


interface DBUserLike {
  uuid: string;
  username: string;
  email: string | null;
  email_verified: number;
  email_domain: string | null;
  role: string;
  status: string;
  club: string | null;
  peer_id: string | null;
  created_at: number;
}


interface DBProfileLike {
  uuid: string;
  name: string;
  model: 'default' | 'slim';
}


function dbUserToProtoUser(
  u: DBUserLike,
  profiles?: DBProfileLike[],
) {
  const protoProfiles = profiles?.map((p) =>
    create(PlayerProfileSchema, {
      id: p.uuid,
      uuid: p.uuid,
      name: p.name,
      model: p.model,
    }),
  ) ?? [];

  return create(UserSchema, {
    uuid: u.uuid,
    username: u.username,
    email: u.email ?? '',
    emailVerified: u.email_verified === 1,
    emailDomain: u.email_domain ?? '',
    role: u.role,
    status: u.status,
    club: u.club ?? '',
    peerId: u.peer_id ?? '',
    createdAt: BigInt(u.created_at),
    profiles: protoProfiles,
    minecraftUuid: '',
    minecraftName: '',
  });
}

export default app;
