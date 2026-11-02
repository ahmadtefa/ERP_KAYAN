// The only sanctioned way to run `prisma migrate dev` / `migrate diff` here.
//
// Those commands need a shadow database: a scratch database the schema engine
// creates, writes to and DROPS. Prisma will happily accept any URL for it, and
// it cannot know that two different hostnames are the same machine. This wrapper
// proves the shadow is a different PostgreSQL server before the engine is given
// it, and refuses otherwise:
//
//   * no shadow configured                    -> refuse
//   * shadow URL equals the live URL          -> refuse
//   * same server, different database name    -> refuse (DROP DATABASE lives there)
//   * same server, different ?schema=         -> refuse (a schema is not a server)
//   * different name, same resolved address   -> refuse (two names, one machine)
//   * shadow host cannot be resolved          -> refuse (cannot prove separation)
//
// `migrate deploy` - the only migration command that runs against a customer
// database - needs no shadow at all, so it never passes through here and is
// unaffected by these rules.
//
// Usage:
//   npm run prisma:migrate -- --name add_something
//   DATABASE_URL=... KAYAN_PRISMA_SHADOW_DATABASE_URL=... npm run prisma:migrate
//
// Exit codes: 0 success, 1 Prisma failed, 78 the shadow configuration was refused.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ShadowDatabaseRefused,
  assertSafeShadowDatabase,
} from './prisma-shadow-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const prismaCli = join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');

const args = process.argv.slice(2);
// --check-only: run the safety proof and stop. Used by the isolation suite and
// by `npm run prisma:shadow-guard`, so the exact code path that guards a real
// migration is the one under test.
const checkOnly = args.includes('--check-only');
const effectiveArgs = args.filter((arg) => arg !== '--check-only');
const command = effectiveArgs[0] === 'diff' ? ['migrate', 'diff'] : ['migrate', 'dev'];
const passthrough = effectiveArgs[0] === 'diff' ? effectiveArgs.slice(1) : effectiveArgs;

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const shadowUrl = process.env.KAYAN_PRISMA_SHADOW_DATABASE_URL ?? '';

  let shadow;
  try {
    shadow = await assertSafeShadowDatabase({ databaseUrl, shadowUrl });
  } catch (error) {
    if (error instanceof ShadowDatabaseRefused) {
      console.error(
        [
          '',
          'Shadow database refused: ' + error.code,
          '  ' + error.message,
          '',
          '`migrate dev` and `migrate diff` are not enabled in this environment.',
          'Point KAYAN_PRISMA_SHADOW_DATABASE_URL at a separate, throwaway PostgreSQL',
          'instance (its own port or machine). Never at the server that holds company data.',
          'Applying already-written migrations needs no shadow: use `npm run prisma:deploy`.',
          '',
        ].join('\n'),
      );
      return 78;
    }
    throw error;
  }

  console.log(
    `shadow database verified as a separate server: ${shadow.host}:${shadow.port}/${shadow.database}`,
  );
  if (checkOnly) return 0;

  const result = spawnSync(
    process.execPath,
    [prismaCli, ...command, ...passthrough],
    {
      cwd: backendDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Set only after the checks above passed. prisma.config.ts refuses a
        // shadow URL without it, so nothing reaches the schema engine unproven.
        KAYAN_PRISMA_SHADOW_VERIFIED: '1',
        KAYAN_PRISMA_SHADOW_DATABASE_URL: shadowUrl,
      },
    },
  );
  if (result.error) {
    console.error(`Could not start the Prisma CLI: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
  },
);
