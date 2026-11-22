import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePem } from './license-build-policy.mjs';
import { scanPrivateMaterialStream } from './verify-extracted-windows-installer.mjs';

// This checks only a synthetic single-file extractor fixture; it is never
// accepted as a product or as evidence of a complete installer.
export async function verifySyntheticProbe(root, expectedKey) {
  const base = resolve(root), found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(path);
      else throw new Error('Unsupported synthetic probe entry');
    }
  }
  await walk(base);
  if (found.length !== 1 || relative(base, found[0]).replaceAll('\\', '/') !== 'app/public-key.pem') {
    throw new Error('Synthetic probe must contain exactly app/public-key.pem');
  }
  const expected = await readFile(expectedKey), extracted = await readFile(found[0]);
  if (expected.length > 4096 || !extracted.equals(expected)) throw new Error('Synthetic public key does not match extracted bytes');
  validatePem(extracted.toString('utf8'), 'test-signed');
  if (await scanPrivateMaterialStream(createReadStream(found[0]))) throw new Error('Synthetic probe contains private-key material');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Expected extracted root and expected public-key path');
  await verifySyntheticProbe(process.argv[2], process.argv[3]);
  console.log('Synthetic public-key-only extraction verified; not a complete installer.');
}
