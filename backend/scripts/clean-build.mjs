// Remove the compiled output before a release build.
//
// `nest build` compiles into dist/ and never deletes files that the current
// sources no longer produce. A file left behind by an earlier commit therefore
// survives into the packaged backend and ships to the customer. The Windows
// packaging path (distribution/windows/build-installer.ps1) and
// .github/workflows/windows-build-only.yml both call `npm run build:clean`
// precisely to avoid that.
//
// This is a real module rather than an inline `node -e` one-liner because the
// Windows build runs the same script through cmd.exe, where nested quoting in
// package.json is a portability trap.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(backend, 'dist');

// force: a missing dist/ is normal on a clean checkout and is not a failure.
// recursive: dist/ holds nested module directories.
rmSync(dist, { recursive: true, force: true });
console.log(`clean-build: removed ${dist}`);
