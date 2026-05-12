
export function getBaseUrl(c: { req: { header: (name: string) => string | undefined } }): string {
  const host = c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

export function getClientIP(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP')
    ?? c.req.header('True-Client-IP')
    ?? c.req.header('X-Forwarded-For')
    ?? 'unknown';
}
