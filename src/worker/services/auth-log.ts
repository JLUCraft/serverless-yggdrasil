import type { D1Database } from '@cloudflare/workers-types';

export type AuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'token_invalid'
  | 'token_expired'
  | 'register'
  | 'logout'
  | 'email_verified'
  | 'password_reset';

export interface AuthLogEntry {
  event_type: AuthEventType;
  user_id?: number | undefined;
  username?: string | undefined;
  ip_address?: string | undefined;
  user_agent?: string | undefined;
  details?: string | undefined;
}

export async function logAuthEvent(db: D1Database, entry: AuthLogEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO auth_logs (event_type, user_id, username, ip_address, user_agent, details)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.event_type,
        entry.user_id ?? null,
        entry.username ?? null,
        entry.ip_address ?? null,
        entry.user_agent ?? null,
        entry.details ?? null
      )
      .run();
  } catch {
    // Silently ignore logging failures to avoid breaking auth flow
  }
}
