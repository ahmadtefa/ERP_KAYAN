import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePem } from './license-build-policy.mjs';

const REQUIRED_SUFFIXES = [
  'erp_kayan.exe',
  'flutter_windows.dll',
  'data/icudtl.dat',
  'data/flutter_assets/AssetManifest.bin',
  'build/web/index.html',
  'backend/dist/src/main.js',
  'backend/dist/prisma/seed.js',
  'backend/node/node.exe',
  'backend/postgres/bin/initdb.exe',
  'backend/postgres/bin/pg_ctl.exe',
  'backend/postgres/bin/pg_isready.exe',
  'backend/postgres/bin/psql.exe',
  'backend/postgres/bin/pg_dump.exe',
  'backend/postgres/bin/pg_restore.exe',
  'backend/node_modules/prisma/build/index.js',
  'backend/node_modules/@prisma/client/package.json',
  'backend/node_modules/.prisma/client/index.js',
  'backend/prisma/schema.prisma',
  'backend/prisma/migrations/migration_lock.toml',
  'backend/scripts/prepare-database.mjs',
  'backend/scripts/database-state.mjs',
  'backend/scripts/migrate-deploy.mjs',
  'prerequisites/vc_redist.x64.exe',
  'runtime-manifest.json',
  'public-key.pem',
  'install-runtime.ps1',
  'repair-runtime.ps1',
  'reset-kayan.ps1',
  'remove-runtime.ps1',
  'repair-kayan.bat',
  'database-control.ps1',
  'UnelevatedProcess.cs',
  'RepairTool.exe',
  'licenses/LICENSE',
  'licenses/PostgreSQL-LICENSE',
];

const PRIVATE_MARKERS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /MC4CAQAwBQYDK2VwBCIEI/,
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '').toLowerCase();
}

function hasSuffix(paths, suffix) {
  const wanted = normalizePath(suffix);
  return paths.some((path) => path === wanted || path.endsWith('/' + wanted));
}

async function listFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are forbidden in the extracted payload.');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(full);
      else throw new Error('The extracted payload contains an unsupported filesystem entry.');
    }
  }
  await walk(root);
  return files;
}

async function scanForPrivateMaterial(file) {
  let tail = '';
  for await (const chunk of createReadStream(file)) {
    const text = tail + chunk.toString('latin1');
    if (PRIVATE_MARKERS.some((pattern) => pattern.test(text))) return true;
    tail = text.slice(-128);
  }
  return false;
}

export async function verifyExtractedPayload({ artifactPath, root, expectedSourceCommit }) {
  const artifact = resolve(artifactPath);
  const payloadRoot = resolve(root);
  if (!expectedSourceCommit || !/^[0-9a-f]{40}$/i.test(expectedSourceCommit)) {
    throw new Error('An exact 40-character source commit is required.');
  }
  const artifactInfo = await stat(artifact);
  if (!artifactInfo.isFile() || artifactInfo.size <= 0) throw new Error('The candidate installer is missing or empty.');
  const artifactHashBefore = await sha256File(artifact);

  const files = await listFiles(payloadRoot);
  if (files.length === 0) throw new Error('The extractor produced an empty payload.');
  const relativePaths = files.map((file) => normalizePath(relative(payloadRoot, file)));
  for (const forbidden of relativePaths) {
    if (/(^|\/)(?:private[-_]?key(?:\..*)?|\.env(?:\..*)?|[^/]+\.(?:p12|pfx|jks|keystore))$/i.test(forbidden)) {
      throw new Error('A forbidden private-key or environment filename is present in the extracted payload.');
    }
    if (/(^|\/)demo-company\.json$/i.test(forbidden)) {
      throw new Error('The production installer unexpectedly contains the demo-company backup.');
    }
  }

  const missing = REQUIRED_SUFFIXES.filter((suffix) => !hasSuffix(relativePaths, suffix));
  if (missing.length) throw new Error('Required runtime payload entries are missing: ' + missing.join(', '));
  if (!relativePaths.some((path) => /(^|\/)backend\/prisma\/migrations\/[^/]+\/migration\.sql$/i.test(path))) {
    throw new Error('The extracted payload contains no actual Prisma migration SQL.');
  }
  if (!relativePaths.some((path) => /(^|\/)backend\/postgres\/lib\/.+/i.test(path))) {
    throw new Error('The extracted payload contains no PostgreSQL runtime libraries.');
  }
  if (!relativePaths.some((path) => /(^|\/)backend\/postgres\/share\/.+/i.test(path))) {
    throw new Error('The extracted payload contains no PostgreSQL shared runtime data.');
  }

  const manifests = files.filter((file) => normalizePath(relative(payloadRoot, file)) === 'runtime-manifest.json'
    || normalizePath(relative(payloadRoot, file)).endsWith('/runtime-manifest.json'));
  if (manifests.length !== 1) throw new Error('The extracted payload has a missing or ambiguous runtime manifest.');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifests[0], 'utf8'));
  } catch {
    throw new Error('The extracted runtime manifest is unreadable.');
  }
  if (manifest.sourceCommit?.toLowerCase() !== expectedSourceCommit.toLowerCase()) {
    throw new Error('The installer manifest source commit does not match the exact CI checkout.');
  }
  if (manifest.product !== 'KAYAN ERP' || manifest.architecture !== 'x64') {
    throw new Error('The extracted runtime manifest does not identify the expected x64 KAYAN ERP product.');
  }
  if (manifest.licenseBuildKind !== 'product' || manifest.licenseEnforcement !== 'enforce') {
    throw new Error('The extracted installer is not a licence-enforced product build.');
  }

  const publicKeys = files.filter((file) => basename(file).toLowerCase() === 'public-key.pem');
  if (publicKeys.length !== 1) throw new Error('The extracted payload has a missing or ambiguous installed public key.');
  const publicKeyBytes = await readFile(publicKeys[0]);
  const publicKeyHash = sha256(publicKeyBytes);
  if (typeof manifest.licensePublicKeySha256 !== 'string'
      || manifest.licensePublicKeySha256.toLowerCase() !== publicKeyHash) {
    throw new Error('The runtime manifest public-key hash does not match the extracted key bytes.');
  }
  const fingerprint = validatePem(publicKeyBytes.toString('utf8'), 'product');

  for (const file of files) {
    if (await scanForPrivateMaterial(file)) {
      throw new Error('A supported private-key marker was found in an extracted payload file.');
    }
  }

  const artifactHashAfter = await sha256File(artifact);
  if (artifactHashAfter !== artifactHashBefore) throw new Error('The candidate installer changed during inspection.');

  const totalPayloadBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size)))
    .reduce((sum, size) => sum + size, 0);
  return {
    result: 'payload-inspection-passed-not-install-tested',
    sourceCommit: expectedSourceCommit,
    installer: {
      path: basename(artifact),
      bytes: artifactInfo.size,
      sha256: artifactHashBefore,
    },
    payload: {
      fileCount: files.length,
      uncompressedBytes: totalPayloadBytes,
      requiredEntries: REQUIRED_SUFFIXES.length,
      migrationSqlCount: relativePaths.filter((path) => /(^|\/)backend\/prisma\/migrations\/[^/]+\/migration\.sql$/i.test(path)).length,
      postgresLibraryFiles: relativePaths.filter((path) => /(^|\/)backend\/postgres\/lib\/.+/i.test(path)).length,
      postgresSharedFiles: relativePaths.filter((path) => /(^|\/)backend\/postgres\/share\/.+/i.test(path)).length,
    },
    licensing: {
      buildKind: manifest.licenseBuildKind,
      enforcement: manifest.licenseEnforcement,
      publicKeySha256: publicKeyHash,
      publicKeyFingerprint: fingerprint,
      privateKeyMarkersFound: false,
    },
  };
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--artifact', '--root', '--source-commit', '--report'].includes(flag) || !value || value.startsWith('--')) {
      throw new Error('Usage: --artifact <setup.exe> --root <extracted-dir> --source-commit <40-char-sha> [--report <path>]');
    }
    const key = ({ '--artifact': 'artifactPath', '--root': 'root', '--source-commit': 'expectedSourceCommit', '--report': 'reportPath' })[flag];
    if (result[key] !== undefined) throw new Error('Duplicate command-line option.');
    result[key] = value;
  }
  if (!result.artifactPath || !result.root || !result.expectedSourceCommit) {
    throw new Error('Usage: --artifact <setup.exe> --root <extracted-dir> --source-commit <40-char-sha> [--report <path>]');
  }
  return result;
}

async function main(args) {
  const options = parseArgs(args);
  const report = await verifyExtractedPayload(options);
  const json = JSON.stringify(report, null, 2);
  if (options.reportPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(options.reportPath), json + '\n', { flag: 'wx' });
  }
  console.log(json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const safeMessage = String(error.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    if (process.env.GITHUB_ACTIONS === 'true') console.log('::error title=Extracted installer verification refused::' + safeMessage);
    console.error('Extracted installer verification refused: ' + error.message);
    process.exitCode = 1;
  });
}
