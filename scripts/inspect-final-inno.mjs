// Fail-closed inspection of the final Inno executable. The caller must build
// and fixture-test the pinned innoextract source and provide its SHA-256.
// Extracted files are private temporary data and are deleted after scanning.
// The marker scan is limited; it is not proof that every secret is absent.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyExtractedPayload } from './verify-extracted-windows-installer.mjs';

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

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--artifact', '--extractor', '--extractor-sha256', '--source-commit', '--report', '--mode'].includes(flag) ||
        !value || value.startsWith('--') || Object.hasOwn(options, flag)) {
      throw new Error('Expected --artifact, --extractor, --extractor-sha256, --source-commit and optional --report/--mode.');
    }
    options[flag] = value;
  }
  if (!options['--artifact'] || !options['--extractor'] || !/^[a-f0-9]{64}$/i.test(options['--extractor-sha256'] ?? '') ||
      !/^[a-f0-9]{40}$/i.test(options['--source-commit'] ?? '') || !['product', 'test-signed'].includes(options['--mode'] ?? 'product')) {
    throw new Error('A pinned extractor hash, exact source commit and valid mode are required.');
  }
  return options;
}

async function main(args) {
  const opts = parseArgs(args);
  const artifact = resolve(opts['--artifact']);
  const extractor = resolve(opts['--extractor']);
  if (await hash(extractor) !== opts['--extractor-sha256'].toLowerCase()) throw new Error('Extractor binary SHA-256 mismatch.');
  const before = await hash(artifact);
  const temp = await mkdtemp(join(tmpdir(), 'kayan-inno-inspect-'));
  try {
    // Do not exclude temporary entries: the comparison key and any other
    // bundled files must receive the same policy and private-material scan.
    // Unknown Inno versions, failed checksums and extractor errors fail closed.
    const result = spawnSync(extractor, ['--extract', '--test', '--no-extract-unknown', '--collisions', 'error', '--output-dir', temp, '--', artifact], {
      stdio: 'ignore', timeout: 900000, windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('Trusted Inno extractor failed or refused the installer.');
    const report = await verifyExtractedPayload({
      artifactPath: artifact, root: temp, expectedSourceCommit: opts['--source-commit'], mode: opts['--mode'] ?? 'product',
    });
    if (await hash(artifact) !== before) throw new Error('Installer changed during inspection.');
    if (opts['--report']) await writeFile(opts['--report'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(`Final Inno payload inspected (${opts['--mode'] ?? 'product'}): ${before}. The private-material scan is limited.`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    const reason = String(e.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=Inno inspection refused::${reason}`);
    console.error(`Inno inspection refused: ${e.message}`);
    process.exitCode = 1;
  });
}
