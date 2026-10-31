import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Desktop preparation must not announce an unmigrated database as ready when
// a package accidentally omits Prisma. No database is touched on this path.
export function prismaCliAvailable(backendDir) {
  return existsSync(join(backendDir, 'node_modules', 'prisma', 'build', 'index.js'));
}

export function deployMigrations(backendDir) {
  const cli = join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');
  if (!prismaCliAvailable(backendDir)) {
    console.error('  migrations: bundled Prisma CLI is missing; preparation stopped');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: backendDir,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
