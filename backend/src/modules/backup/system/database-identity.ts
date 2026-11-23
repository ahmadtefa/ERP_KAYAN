import { createHash } from 'node:crypto';

/** Bind recovery to its target without persisting credentials. Changing the
 * database/host requires investigation, never automatic replay of an old copy.
 */
export function databaseFingerprint(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Database identity is unavailable');
  const url = new URL(raw);
  return createHash('sha256').update(JSON.stringify([
    url.hostname.toLowerCase(), url.port || '5432', decodeURIComponent(url.pathname),
  ])).digest('hex');
}
