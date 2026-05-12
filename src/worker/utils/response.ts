import type { ApiError, ApiSuccess } from '../types';

export function json<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function success<T>(data: T, message: string = 'OK'): Response {
  const resp: ApiSuccess<T> = { code: 200, message, data };
  return json(resp, 200);
}

export function error(message: string, status: number = 400, cause?: string): Response {
  const resp: ApiError = { error: getErrorName(status), errorMessage: message };
  if (cause) resp.cause = cause;
  return json(resp, status);
}

function getErrorName(status: number): string {
  const map: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  };
  return map[status] ?? 'Unknown Error';
}


export function pngResponse(data: ArrayBuffer | Uint8Array, status: number = 200): Response {
  return new Response(data, {
    status,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
}


export function yggdrasilError(
  error: string,
  errorMessage: string,
  cause?: string,
  status: number = 403
): Response {
  return json({ error, errorMessage, cause }, status);
}
