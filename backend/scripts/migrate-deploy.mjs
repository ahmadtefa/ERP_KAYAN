import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Desktop preparation must not announce an unmigrated database as ready when
// a package accidentally omits Prisma. No database is touched on this path.
export function prismaCliAvailable(backendDir) {
  return existsSync(join(backendDir, 'node_modules', 'prisma', 'build', 'index.js'));
}

/// Why this no longer shells out to `prisma migrate deploy`
/// -------------------------------------------------------
/// `prisma migrate deploy` in Prisma 6.19.3 runs the schema engine as WebAssembly
/// with the pg driver adapter. That path is broken for this project's migrations
/// in two independent ways:
///
///   1. `initialize()` — the step that creates and locks `_prisma_migrations` —
///      queries `current_schema()`, which PostgreSQL declares as type `name`
///      (OID 19). The adapter's `fieldToColumnType()` has no case for OID 19 and
///      throws `UnsupportedNativeDataType`, surfacing as
///      "Column type 'name' could not be deserialized from the database".
///      `scripts/patch-adapter-pg-name-type.mjs` repairs that mapping.
///
///   2. With that repaired, `apply_script` still sends a statement containing a
///      `CREATE OR REPLACE FUNCTION ... AS $$ ... $$ LANGUAGE plpgsql` body. The
///      WASM connector's statement splitter breaks the dollar-quoted body apart,
///      so the fragment after the first internal `;` reaches the server as bare
///      SQL and the migration dies with
///      `syntax error at or near "this"`. Seven of this project's migrations
///      define PL/pgSQL functions, and they are correct SQL — they apply without
///      complaint through `pg` and through `prisma db execute`.
///
/// The native schema-engine binary that handles dollar-quoting correctly cannot
/// be used here either: this project disables the engine download on purpose
/// (see prisma.config.ts) so installs work offline and in locked-down CI, and
/// `binaries.prisma.sh` is unreachable from those machines.
///
/// So the project applies its own migration files with `scripts/apply-migrations.mjs`,
/// which:
///   * runs the same `prisma/migrations/*/migration.sql` files, in the same order;
///   * records them in the same `_prisma_migrations` table, with the same
///     SHA-256 checksums and the same columns Prisma writes;
///   * wraps each migration in a transaction, skips already-applied ones,
///     refuses a file edited after it was applied, and refuses a database built
///     by a different branch;
///   * never drops, resets, or `db push`es.
///
/// A database migrated this way is reported as "Database schema is up to date!"
/// by `prisma migrate status`, and vice versa — the two are interchangeable.
/// That is verified, not assumed: see scripts/verify-migrator-parity.mjs.
export function deployMigrations(backendDir) {
  if (!prismaCliAvailable(backendDir)) {
    console.error('  migrations: bundled Prisma CLI is missing; preparation stopped');
    return Promise.resolve(1);
  }
  const script = join(backendDir, 'scripts', 'apply-migrations.mjs');
  if (!existsSync(script)) {
    console.error(`  migrations: ${script} is missing; preparation stopped`);
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: backendDir,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
