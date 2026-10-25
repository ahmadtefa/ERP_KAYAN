/// What an operator must know about where this API is listening.
///
/// The program is a company server: it binds every interface so the other
/// desks can reach it. That is correct on a private network and dangerous on a
/// public one, because the sign-in form would travel in clear text. Rather
/// than silently accepting either, the server says out loud what it is doing
/// and - when explicitly published - refuses to start without the machinery
/// that makes it safe.
export interface ExposureReport {
  /// True when the socket accepts connections from other machines.
  exposed: boolean;
  /// True when the request arrived over TLS, or a proxy told us it did.
  secure: boolean;
  /// A sentence for the server log, or null when everything is in order.
  warning: string | null;
}

/// Reads `X-Forwarded-Proto` / `X-Forwarded-For`, but only when the operator
/// has declared that a proxy exists. Trusting the header unconditionally would
/// let any client claim to be HTTPS.
export function forwardedProtocol(headers: Record<string, unknown>): string | null {
  const value = headers['x-forwarded-proto'];
  if (typeof value === 'string' && value.trim()) {
    return value.split(',')[0].trim().toLowerCase();
  }
  return null;
}

/// True when the process was told to accept a public deployment.
export function isPublishedExposure(): boolean {
  return process.env.KAYAN_ALLOW_PUBLIC_HTTP === '1';
}

/// True when the operator declared a trusted reverse proxy in front of the API.
export function hasTrustedProxy(): boolean {
  return (process.env.KAYAN_TRUST_PROXY ?? '').trim().length > 0;
}

/// The address a request actually reached the server on.
///
/// `HOST=0.0.0.0` is not an address anyone can open; the settings screen must
/// report the real one instead of printing the wildcard, which looks like a
/// broken link.
export function advertisedHost(
  bindHost: string,
  headers: Record<string, unknown>,
  localAddress: string | undefined,
): string {
  const forwarded = headers['x-forwarded-host'];
  if (hasTrustedProxy() && typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const requested = headers['host'];
  if (typeof requested === 'string' && requested.trim()) {
    return requested.trim();
  }
  if (bindHost && bindHost !== '0.0.0.0' && bindHost !== '::') return bindHost;
  return localAddress && localAddress.length > 0 ? localAddress : 'localhost';
}

/// The warning the server prints at start-up, or null when none is needed.
export function exposureWarning(input: {
  exposed: boolean;
  published: boolean;
  hasTlsTerminator: boolean;
}): string | null {
  if (!input.exposed) return null;
  if (input.hasTlsTerminator) return null;
  if (input.published) {
    return (
      'Refusing to publish this API over plain HTTP: set KAYAN_TRUST_PROXY and ' +
      'KAYAN_TLS_TERMINATED=1 only when a reverse proxy already terminates ' +
      'HTTPS and forwards to this port, or set HOST=127.0.0.1 behind a VPN.'
    );
  }
  return (
    'The API is reachable from the local network over plain HTTP. That is ' +
    'fine on a private network; do not forward this port from the router. ' +
    'For access from outside, publish it through an HTTPS reverse proxy or a ' +
    'VPN - see docs/REMOTE_ACCESS.md.'
  );
}

/// True when the operator says TLS is terminated in front of this process.
export function tlsTerminatedByProxy(): boolean {
  return process.env.KAYAN_TLS_TERMINATED === '1';
}

/// Refuses to start a deliberately published plain-HTTP server.
export function assertSafeExposure(input: {
  exposed: boolean;
  published: boolean;
  hasTlsTerminator: boolean;
}): void {
  if (input.exposed && input.published && !input.hasTlsTerminator) {
    throw new Error(exposureWarning(input) ?? 'Unsafe public exposure');
  }
}
