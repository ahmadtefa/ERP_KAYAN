// Fail-closed, limited inspection of the final Inno executable. Requires a
// trusted 7z version capable of listing and streaming Inno payloads. No files
// are extracted to disk, and no key material is printed. This is not proof that
// all secrets (e.g. nested/encrypted/unknown formats) are absent.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePem } from './license-build-policy.mjs';

export function inspectListing(text) {
  const separator = text.indexOf('----------');
  if (separator < 0 || !/^Type = Inno\s*$/m.test(text.slice(0, separator))) throw new Error('Not a recognized Inno payload.');
  const records = text.slice(separator + 10).split(/\r?\n\s*\r?\n/);
  const files = [];
  for (const record of records) {
    const fields = Object.fromEntries(record.split(/\r?\n/).map(line => line.match(/^([^=]+) = (.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
    if (!fields.Path) continue;
    if (fields.Folder === '+' || fields.Attributes?.startsWith('D')) continue;
    if (fields.Encrypted !== '-') throw new Error('Encrypted or unverifiable content cannot be inspected.');
    if (/[\r\n*?]/.test(fields.Path)) throw new Error('Ambiguous Inno entry name.');
    const name = fields.Path.replaceAll('\\', '/').split('/').pop().toLowerCase();
    if (/^(?:private[-_]?key(?:\..*)?|\.env(?:\..*)?)$/i.test(name) || /\.(?:p12|pfx|jks|keystore)$/i.test(name)) {
      throw new Error('A forbidden private-key or environment filename is present.');
    }
    files.push(fields.Path);
  }
  const keys = files.filter(path => /(?:^|[\\/])public-key\.pem$/i.test(path));
  // Setup intentionally includes a pre-install comparison copy and an app
  // copy; inspect both. Duplicate names are ambiguous and therefore refused.
  if (files.length === 0 || keys.length < 1 || keys.length > 2 || new Set(keys).size !== keys.length) {
    throw new Error('The final installer has missing or ambiguous public-key.pem entries.');
  }
  return keys;
}

const markers = [/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, /MC4CAQAwBQYDK2VwBCIEI/];
export function inspectChunk(chunk, previous = '') {
  const text = previous + chunk.toString('latin1');
  return { found: markers.some(pattern => pattern.test(text)), tail: text.slice(-128) };
}

async function stream(args, collect = false) {
  const proc = spawn('7z', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let error = null, found = false, tail = '', size = 0;
  const parts = [];
  proc.on('error', e => { error = e; });
  const done = new Promise(resolveExit => proc.once('close', resolveExit));
  try {
    for await (const chunk of proc.stdout) {
      const result = inspectChunk(chunk, tail);
      found ||= result.found;
      tail = result.tail;
      if (collect) {
        size += chunk.length;
        if (size <= 4096) parts.push(chunk);
      }
    }
  } catch (e) { error = e; }
  const code = await done;
  if (error || code !== 0) throw new Error('Could not stream the complete Inno payload.');
  if (found) throw new Error('A supported private-key marker was found in the final installer.');
  if (collect && size > 4096) throw new Error('The embedded public key is too large.');
  return Buffer.concat(parts);
}

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function main(args) {
  // The default remains product: diagnostic mode must be explicit and is
  // never release evidence. Both modes use the same fail-closed payload scan.
  if ((args.length !== 2 && args.length !== 4) || args[0] !== '--artifact' ||
      (args.length === 4 && (args[2] !== '--mode' || args[3] !== 'test-signed'))) {
    throw new Error('Usage: --artifact <installer.exe> [--mode test-signed]');
  }
  const path = args[1];
  const mode = args.length === 4 ? 'test-signed' : 'product';
  const before = await hash(path);
  const list = spawnSync('7z', ['l', '-slt', '--', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  if (list.error) throw new Error(list.error.code === 'ENOENT'
    ? '7z is not available on PATH; the final Inno payload was not inspected.'
    : 'Could not start 7z to list the final Inno payload.');
  if (list.status !== 0) throw new Error(`7z could not list the final Inno payload (exit ${list.status ?? 'unknown'}).`);
  const keyPaths = inspectListing(list.stdout);
  for (const keyPath of keyPaths) {
    const publicPem = await stream(['x', '-so', '-spd', '--', path, keyPath], true);
    validatePem(publicPem.toString('utf8'), mode);
  }
  await stream(['x', '-so', '--', path]);
  if (await hash(path) !== before) throw new Error('Installer changed during inspection.');
  console.log(`Final Inno inspected (${mode}): ${before}. Secret marker scan is limited, not proof of absence.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    // Preserve a concise, non-sensitive reason in Actions annotations even
    // when the runner log archive is unreachable. Never emit payload bytes.
    const reason = String(e.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=Inno inspection refused::${reason}`);
    console.error(`Inno inspection refused: ${e.message}`);
    process.exitCode = 1;
  });
}
