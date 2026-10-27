#!/usr/bin/env node
/**
 * Packages the key generator as one executable.
 *
 * The tool itself has no dependencies and needs no install: it is plain Node.
 * The operator, however, must not be asked to install Node. Node's
 * single-executable support solves exactly that - the runtime is the
 * executable - and this script performs the two steps it needs:
 *
 *   1. bundle the generator (ESM) into the one CommonJS file SEA runs;
 *   2. copy a Node binary and inject the blob with `postject`.
 *
 * Both `esbuild` and `postject` are build-time tools used by whoever builds
 * the deliverable. They are never part of what the operator runs, and nothing
 * they do touches a signing key: no key exists at build time, and none is
 * embedded.
 *
 *   node build.mjs                     # current platform -> dist/
 *   node build.mjs --target win32-x64  # from Windows CI, base = this node.exe
 *   node build.mjs --base-node PATH --target win32-x64   # cross-build
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..');
const ROOT = resolve(TOOL, '..', '..');

const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
}

const platform = arg('platform', process.platform);
const arch = arg('arch', process.arch);
const target = `${platform}-${arch}`;
const outDir = resolve(arg('out', join(TOOL, 'dist')));
const name = platform === 'win32' ? 'KAYAN-Key-Generator.exe' : 'kayan-key-generator';

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', cwd: HERE, ...options });
}

function log(message) {
  console.log(`[package] ${message}`);
}

// ── 1. bundle ──────────────────────────────────────────────────────────────
const work = join(HERE, '.work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const bundle = join(work, 'generator.cjs');
log(`bundling ${join(TOOL, 'sea', 'entry.mjs')} -> ${bundle}`);

const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [join(HERE, 'entry.mjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  // The guard that makes `import.meta.url === argv[1]` decide whether to start
  // the CLI has no meaning inside the executable; SEA always starts it.
  define: { 'import.meta.url': 'undefined' },
  logLevel: 'warning',
});

// ── 2. the SEA blob ────────────────────────────────────────────────────────
const blob = join(work, 'sea-prep.blob');
const config = join(work, 'sea-config.json');
writeFileSync(
  config,
  JSON.stringify(
    {
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  ),
);
log('preparing the single-executable blob');
run(process.execPath, ['--experimental-sea-config', config], { cwd: work });

// ── 3. the base runtime ────────────────────────────────────────────────────
let baseNode = arg('base-node');
const selfSuffix = process.platform === 'win32' ? '' : '';
if (!baseNode) {
  const samePlatform = process.platform === platform && process.arch === arch;
  if (!samePlatform) {
    console.error(
      `\nCannot build ${target} from ${process.platform}-${process.arch} without a ` +
        'matching runtime.\n' +
        `  Download the official ${target} zip, unpack it, and pass:\n` +
        `    node build.mjs --target ${target} --base-node <folder>/node${selfSuffix}.exe\n`,
    );
    process.exit(2);
  }
  baseNode = process.execPath;
}
if (!existsSync(baseNode)) {
  console.error(`\nBase runtime not found: ${baseNode}\n`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const output = join(outDir, name);
copyFileSync(baseNode, output);
log(`base runtime ${baseNode} (${Math.round(statSync(baseNode).size / 1048576)} MB)`);

// ── 4. inject ──────────────────────────────────────────────────────────────
log('injecting the blob');
const postject = join(HERE, 'node_modules', 'postject', 'dist', 'cli.js');
if (!existsSync(postject)) {
  console.error('\npostject is missing. Run "npm install" in tools/license-generator/sea first.\n');
  process.exit(2);
}
run(process.execPath, [
  postject,
  output,
  'NODE_SEA_BLOB',
  blob,
  '--sentinel-fuse',
  FUSE,
]);

// ── 5. keep the provenance beside the binary ───────────────────────────────
const header = readFileSync(bundle, 'utf8');
if (header.includes('BEGIN PRIVATE KEY')) {
  rmSync(output, { force: true });
  console.error('\nThe bundle contains private-key material. Removed the executable.\n');
  process.exit(3);
}

const nodeVersion = process.version;
writeFileSync(
  join(outDir, 'BUILD-INFO.txt'),
  `KAYAN Key Generator — build information
built at      : ${new Date().toISOString()}
target        : ${target}
entry point   : ${name}
node runtime  : ${nodeVersion} (bundled; no install needed)
built from    : ${ROOT}
tool version  : ${JSON.parse(readFileSync(join(TOOL, 'package.json'), 'utf8')).version}
source        : tools/license-generator/kayan-license.mjs
                tools/license-generator/license-gui.mjs

This package contains no signing key. The operator supplies the key folder with
--home or KAYAN_LICENSE_HOME (default: %USERPROFILE%\\.kayan-license-generator).
`,
);

if (platform !== 'win32') {
  execFileSync('chmod', ['+x', output]);
}

const size = Math.round(statSync(output).size / 1048576);
log(`done: ${output} (${size} MB)`);
log('no signing key is embedded; the operator supplies the key folder.');
