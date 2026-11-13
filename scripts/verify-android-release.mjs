// Final APK verification, for use only on a trusted runner with genuine Android
// SDK build-tools and unzip on PATH. It never signs an APK or reads a private key.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateApkMetadata(certificatePin, signerOutput, badging) {
  if (!/^[0-9a-f]{64}$/.test(certificatePin)) throw new Error('Approved app-signing certificate pin is invalid.');
  // Reject more than one signer even if one happens to be approved.
  const digests = [...signerOutput.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$/gm)];
  if (digests.length !== 1 || digests[0][1] !== '1' || digests[0][2].toLowerCase() !== certificatePin) {
    throw new Error('APK signer set does not match the approved app-signing certificate.');
  }
  const subjects = [...signerOutput.matchAll(/^Signer #(\d+) certificate DN: (.+)$/gm)];
  if (subjects.length !== 1 || subjects[0][1] !== '1' || /(?:^|[,/])\s*CN\s*=\s*Android Debug(?:\s*[,/]|\s*$)/i.test(subjects[0][2])) {
    throw new Error('APK signer subject is missing or identifies the Android debug certificate.');
  }
  if (!/^package: name='com\.kayan\.kayan_key_generator'(?:\s|$)/m.test(badging) ||
      /^application-debuggable(?:\s|$)/m.test(badging)) {
    throw new Error('APK package is wrong or APK is debuggable.');
  }
  return true;
}

const markers = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /MC4CAQAwBQYDK2VwBCIEI/,
];

export function scanChunk(chunk, tail = '') {
  const text = tail + chunk.toString('latin1');
  return { found: markers.some(pattern => pattern.test(text)), tail: text.slice(-128) };
}

// This checks only recognizable plaintext indicators in uncompressed ZIP
// entries. It cannot rule out encrypted/nested files or every key format.
export async function scanUncompressedEntries(apk) {
  const child = spawn('unzip', ['-p', apk], { stdio: ['ignore', 'pipe', 'ignore'] });
  let tail = '', found = false, failed = null;
  child.on('error', error => { failed = error; });
  const completion = new Promise(resolveExit => child.once('close', resolveExit));
  try {
    for await (const chunk of child.stdout) {
      const result = scanChunk(chunk, tail);
      if (result.found) found = true;
      tail = result.tail;
    }
  } catch (error) { failed = error; }
  const code = await completion;
  if (failed || code !== 0) throw new Error('Could not inspect the uncompressed APK entries.');
  if (found) throw new Error('APK contains a supported private-key indicator.');
}

function tool(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(`Required ${name} inspection failed or tool is unavailable.`);
  return result.stdout;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--apk') throw new Error('Usage: --apk <final-signed-apk>');
  // No CLI or environment override: the pin must be independently approved.
  const pinPath = fileURLToPath(new URL('../distribution/android/APP-SIGNING-CERT-SHA256.txt', import.meta.url));
  let pin;
  try { pin = readFileSync(pinPath, 'utf8').trim().toLowerCase(); }
  catch { throw new Error('Approved Android app-signing certificate pin is missing.'); }
  if (!/^[0-9a-f]{64}$/.test(pin)) throw new Error('Approved Android app-signing certificate pin is invalid.');
  const apk = args[1];
  // apksigner verifies the cryptographic signatures before printing certs.
  const signing = tool('apksigner', ['verify', '--verbose', '--print-certs', apk]);
  const badging = tool('aapt', ['dump', 'badging', apk]);
  validateApkMetadata(pin, signing, badging);
  await scanUncompressedEntries(apk);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(apk)) hash.update(chunk);
  console.log(`APK metadata verified; SHA-256 ${hash.digest('hex')}. Private-key marker scan is limited, not proof of absence.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Android release inspection refused: ${error.message}`);
    process.exitCode = 1;
  });
}
