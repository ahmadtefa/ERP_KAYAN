import { ServiceUnavailableException } from '@nestjs/common';

/**
 * The signing keys, and what to say when they are not there.
 *
 * A token cannot be signed or checked without them, so an installation that
 * has not been given any cannot authenticate anything at all. Left to itself
 * the JWT library answers that with `secretOrPrivateKey must have a value`,
 * which reaches the screen as a bare "Unexpected server error" and tells the
 * person looking after the program nothing.
 *
 * So every use of a key goes through here, and what comes back when one is
 * missing is a sentence naming the variable to set.
 */

export const ACCESS_SECRET_VARIABLE = 'JWT_ACCESS_SECRET';
export const REFRESH_SECRET_VARIABLE = 'JWT_REFRESH_SECRET';

/// The variables that hold no value, empty ones included.
export function missingSecretVariables(): string[] {
  return [ACCESS_SECRET_VARIABLE, REFRESH_SECRET_VARIABLE].filter(
    (name) => !readSecret(name),
  );
}

/// The sentence for the screen, or null when nothing is missing.
export function secretsProblem(): string | null {
  const missing = missingSecretVariables();
  if (missing.length === 0) return null;
  return (
    `This copy of the program has not been given ${missing.join(' and ')}, ` +
    'so it cannot issue or check a sign-in token. Set them in the ' +
    'environment (or in the .env file next to the server) to two long random ' +
    'strings of your own, then start the program again. The packaged Windows ' +
    'program writes them for you the first time it runs.'
  );
}

function readSecret(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

function requireSecret(name: string): string {
  const value = readSecret(name);
  if (value) return value;
  throw new ServiceUnavailableException(secretsProblem() ?? `${name} is not set.`);
}

/// The key a sign-in token and a download ticket are signed with.
export function accessSecret(): string {
  return requireSecret(ACCESS_SECRET_VARIABLE);
}

/// The key a refresh token is signed with.
export function refreshSecret(): string {
  return requireSecret(REFRESH_SECRET_VARIABLE);
}

/// How long a sign-in token lives, in seconds. Fifteen minutes by default.
export function accessTtlSeconds(): number {
  return readCount('JWT_ACCESS_TTL', 900);
}

/// How long a refresh token lives, in seconds. A week by default.
export function refreshTtlSeconds(): number {
  return readCount('JWT_REFRESH_TTL', 604800);
}

/**
 * A lifetime, as a whole number of seconds.
 *
 * Both are read straight from the environment, where a stray "15m" or an
 * empty value would otherwise reach the JWT library and come back as an
 * unusable token or an unhelpful error.
 */
function readCount(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
