/**
 * Which web pages may call this API.
 *
 * A browser refuses to let a page read a response unless the response names
 * that page's origin, so this decides whether the program can be used from
 * another machine at all. It is the difference between "open it on the
 * office tablet" and "sign-in fails and nobody knows why".
 *
 *   * no origin at all — a native app, curl, the mobile build — is always
 *     allowed, because CORS does not apply to it;
 *   * an origin named in `CORS_ORIGINS` is always allowed;
 *   * an address on this machine, or on the network it is standing on, is
 *     allowed: a program that runs on a desk and is opened from a tablet
 *     next to it is the ordinary case, not the exception;
 *   * anything else is allowed while developing, and refused in production —
 *     a real installation names the pages that may talk to it.
 */
export const CONFIGURED_ORIGINS_VARIABLE = 'CORS_ORIGINS';

/**
 * localhost, 127.0.0.1, and the three private address ranges (10/8,
 * 192.168/16, 172.16/12), plus anything ending in `.local` for a machine
 * reached by its name.
 */
export const PRIVATE_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|[a-zA-Z0-9-]+\.local)(:\d+)?$/;

/// The origins the operator named, split and cleaned.
export function configuredOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Whether [origin] may call the API.
 *
 * `undefined` means the request carried no Origin header, which happens for
 * every client that is not a browser page.
 */
export function allowsOrigin(
  origin: string | undefined,
  configured: string[],
  isProduction: boolean,
): boolean {
  if (!origin) return true;
  if (configured.includes(origin)) return true;
  if (PRIVATE_ORIGIN.test(origin)) return true;
  return !isProduction;
}
