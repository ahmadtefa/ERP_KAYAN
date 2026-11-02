// OID 18 (`char`) and OID 19 (`name`) — which layer copes and which does not.
//
// Context. While this project's migration path was being changed, an engine
// reported "Failed to deserialize column of type 'name'" while reading
// PostgreSQL's own catalog. The tempting "fix" is to cast those columns to text
// everywhere, or to change the schema. Both hide the defect: the cast would have
// to be repeated in every future query, and the schema change would be a lie
// about what PostgreSQL is.
//
// So this script measures the layers separately, with real PostgreSQL and the
// real client that ships to customers:
//
//   A. the PostgreSQL server and the pg driver        - control
//   B. Prisma Client with an explicit cast *at the query boundary*
//   C. Prisma Client reading the raw catalog columns   - expected limitation
//   D. the application's own source                   - must not depend on C
//   E. money (numeric) and identifier-length boundaries
//
// What C shows is a *client mapping* limitation, recorded honestly below and in
// backend/PRISMA_MIGRATION_NOTES.md. It does not affect the migration path: the
// native schema engine applies the whole history, and no application query reads
// those columns.
//
//   DATABASE_URL=postgresql://... node scripts/prisma-catalog-types.mjs
//
// Exit code 1 only if something the product relies on is broken.

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('::error title=OID 18/19::DATABASE_URL is not set');
  process.exit(1);
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const limitations = [];

function pass(message) {
  console.log(`PASS: ${message}`);
}
function fail(message) {
  console.error(`::error title=OID 18/19::${message}`);
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function limitation(message) {
  limitations.push(message);
  console.log(`LIMITATION: ${message}`);
  console.log(`::warning title=Prisma client limitation::${message}`);
}

const PRISMA_TYPE_ERROR = /Failed to deserialize column of type '(name|char)'/;

async function main() {
  console.log('A. PostgreSQL server and the pg driver (control)');
  const driver = new pg.Client({ connectionString: url });
  await driver.connect();
  try {
    const { rows } = await driver.query(
      `SELECT c.relname AS relation_name, a.attname AS column_name, a.attidentity AS identity,
              NULL::name AS null_name, NULL::"char" AS null_char,
              length(repeat('a', 70)::name::text) AS truncated
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relname = 'companies' AND a.attname = 'id'`,
    );
    const row = rows[0];
    if (row.relation_name !== 'companies' || typeof row.identity !== 'string') {
      fail(`the driver could not read OID 19/18 columns: ${JSON.stringify(row)}`);
    }
    if (row.null_name !== null || row.null_char !== null) {
      fail(`a NULL name/char did not arrive as null through the driver: ${JSON.stringify(row)}`);
    }
    if (Number(row.truncated) !== 63) {
      fail(`a 70-character name should be truncated to 63 by the server, got ${row.truncated}`);
    }
    pass('server + pg driver: OID 19 (name), OID 18 (char), NULLs and the 63-byte boundary all behave');
  } finally {
    await driver.end().catch(() => {});
  }

  console.log('\nB. Prisma Client with a cast at the query boundary (the supported path)');
  const cast = await client.$queryRaw`
    SELECT
      c.relname::text   AS relation_name,
      a.attname::text   AS column_name,
      a.attstorage::text AS storage,
      a.attidentity::text AS identity
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'companies' AND a.attname IN ('id', 'code', 'nameEn')
    ORDER BY a.attname
  `;
  if (cast.length !== 3) {
    fail(`expected 3 catalog rows through the cast query, got ${cast.length}`);
  }
  for (const row of cast) {
    if (typeof row.relation_name !== 'string' || row.relation_name !== 'companies') {
      fail(`OID 19 read through a cast did not return a string: ${JSON.stringify(row)}`);
    }
    if (typeof row.storage !== 'string' || row.storage.length !== 1) {
      fail(`OID 18 read through a cast did not return one character: ${JSON.stringify(row)}`);
    }
  }
  pass(`Prisma Client read ${cast.length} catalog rows when OID 18/19 are cast at the query boundary`);

  const castNulls = await client.$queryRaw`
    SELECT NULL::name::text AS null_name, NULL::"char"::text AS null_char,
           repeat('b', 63)::name::text AS exact_name,
           length(repeat('a', 70)::name::text) AS truncated_length
  `;
  if (castNulls[0].null_name !== null || castNulls[0].null_char !== null) {
    fail(`a NULL name/char did not arrive as null through a cast: ${JSON.stringify(castNulls[0])}`);
  }
  if (castNulls[0].exact_name?.length !== 63) {
    fail(`a 63-character name did not survive: ${JSON.stringify(castNulls[0])}`);
  }
  if (Number(castNulls[0].truncated_length) !== 63) {
    fail(`the 63-byte boundary was not applied: ${JSON.stringify(castNulls[0])}`);
  }
  pass('NULLs of OID 18/19 arrive as null, 63 characters survive and 70 are truncated - through a cast');

  console.log('\nC. Prisma Client reading the raw catalog columns (expected limitation)');
  const raw = await attempt(() => client.$queryRaw`SELECT relname FROM pg_class WHERE relname = 'companies'`);
  const rawChar = await attempt(() => client.$queryRaw`SELECT attidentity FROM pg_attribute WHERE attrelid = 'companies'::regclass AND attname = 'id'`);
  if (raw.ok) {
    pass('Prisma Client now reads OID 19 (name) columns without a cast');
  } else if (PRISMA_TYPE_ERROR.test(raw.message)) {
    limitation(
      'Prisma Client 6.19.3 (engine-less query compiler) cannot deserialize OID 19 (`name`) in $queryRaw: ' +
        '"Failed to deserialize column of type \'name\'". A cast at the query boundary is required.',
    );
  } else {
    fail(`reading OID 19 failed for an unexpected reason: ${raw.message}`);
  }
  if (rawChar.ok) {
    pass('Prisma Client now reads OID 18 (char) columns without a cast');
  } else if (PRISMA_TYPE_ERROR.test(rawChar.message)) {
    limitation(
      'Prisma Client 6.19.3 cannot deserialize OID 18 (`char`) in $queryRaw either; the same cast applies.',
    );
  } else {
    fail(`reading OID 18 failed for an unexpected reason: ${rawChar.message}`);
  }
  // The regression guard: whatever the client does, it must never hand back a
  // mangled value. Either it deserialises, or it refuses with the documented
  // error - never a truncated name or the string "null".
  if (raw.ok && raw.value?.[0]?.relname !== 'companies') {
    fail(`Prisma Client returned a wrong value for an OID 19 column: ${JSON.stringify(raw.value)}`);
  }

  console.log('\nD. The application does not depend on C');
  const offenders = scanSourceForRawCatalogReads();
  if (offenders.length > 0) {
    fail(
      `production code reads catalog char/name columns without a cast: ${offenders.join(', ')}. ` +
        'Cast at the query boundary (::text) - do not change the schema or the data.',
    );
  }
  pass('no application query reads pg_catalog char/name columns, so the client limitation is not on any product path');

  console.log('\nE. Values that must round-trip exactly');
  const money = await client.$queryRaw`SELECT 1234567890.1234::numeric(19,4) AS amount`;
  if (String(money[0].amount) !== '1234567890.1234') {
    fail(`DECIMAL(19,4) did not round-trip exactly: ${String(money[0].amount)}`);
  }
  pass('DECIMAL(19,4) money round-trips exactly through the same client');

  const longName = `kayan_${'x'.repeat(50)}`.slice(0, 63);
  await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${longName}"`);
  await client.$executeRawUnsafe(`CREATE TABLE "${longName}" (id int primary key)`);
  try {
    const found = await client.$queryRaw`
      SELECT c.relname::text AS relname FROM pg_class c WHERE c.oid = ${longName}::regclass`;
    if (found[0]?.relname !== longName) {
      fail(`a ${longName.length}-character table name did not read back unchanged`);
    }
    pass(`a ${longName.length}-character table name is created and read back unchanged`);
  } finally {
    await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${longName}"`);
  }

  // A single notice line, because GitHub annotations are the only part of a job
  // log that survives a failed step in this repository's reporting.
  const matrix = {
    driver: 'ok',
    clientWithCast: 'ok',
    clientRawName: raw.ok ? 'ok' : 'fails',
    clientRawChar: rawChar.ok ? 'ok' : 'fails',
    appDependsOnRawCatalogRead: offenders.length > 0,
    money: 'ok',
  };
  console.log(`::notice title=OID 18/19 matrix::${JSON.stringify(matrix)}`);

  console.log('\nSummary');
  console.log('  A. server + driver            : OID 18 and 19 fully usable');
  console.log(`  B. Prisma Client + cast       : works${limitations.length ? '' : ' (unchanged)'}`);
  console.log(
    `  C. Prisma Client, no cast     : ${limitations.length ? 'cannot deserialize OID 18/19 (documented limitation)' : 'works'}`,
  );
  console.log('  D. application dependencies   : none');
  console.log(
    '\nThe migration engine is a different component and is proven separately: the native\n' +
      'schema engine applied every checked-in migration in prisma-native-migration-suite.mjs,\n' +
      'including the two migrations that query pg_type.typname (an OID 19 column) themselves.',
  );
}

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) };
  }
}

/** Finds raw catalog reads in application source that do not cast to text. */
function scanSourceForRawCatalogReads() {
  const offenders = [];
  const root = join(backendDir, 'src');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) continue;
      const source = readFileSync(path, 'utf8');
      const queries = source.match(/\$queryRaw(?:Unsafe)?`[^`]*`/g) ?? [];
      for (const query of queries) {
        if (!/\bpg_(class|attribute|type|namespace|catalog)\b/.test(query)) continue;
        // Every catalog select in application code must cast the column it reads.
        const selects = query.match(/SELECT[\s\S]*?FROM/i)?.[0] ?? '';
        const columns = selects
          .replace(/^SELECT/i, '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
        for (const column of columns) {
          if (/::text\b/.test(column)) continue;
          if (/^(count|sum|exists|\d)/i.test(column)) continue;
          offenders.push(`${path.replace(backendDir + '/', '')}: ${column.slice(0, 60)}`);
        }
      }
    }
  };
  walk(root);
  return offenders;
}

main()
  .catch((error) => {
    console.error(`::error title=OID 18/19::${error?.stack ?? error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect().catch(() => {});
  });
