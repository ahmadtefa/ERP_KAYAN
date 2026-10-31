// OID 18 (`char`) and OID 19 (`name`) through the real Prisma Client.
//
// Background: while migrating this project, an engine reported
// "Failed to deserialize column of type 'name'" while reading PostgreSQL's own
// catalog. It is tempting to "fix" that by casting those columns to text. That
// hides the defect and changes nothing for the customer: PostgreSQL's catalog is
// full of `char` and `name` columns, and any tool that reads it has to cope.
//
// So this script does the opposite of hiding it: it asks the *client that ships
// to customers* to read the catalog columns that actually carry those OIDs, and
// records exactly what comes back - values, NULLs, and the 63-byte `name`
// truncation boundary. Whether the *migration engine* copes is answered
// separately, by `prisma-native-migration-suite.mjs`, which runs the native
// engine over the whole history; the two failures are different failures and are
// reported as such.
//
//   DATABASE_URL=postgresql://... node scripts/prisma-catalog-types.mjs

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('::error title=OID 18/19::DATABASE_URL is not set');
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  console.error(`::error title=OID 18/19::${message}`);
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const results = [];

async function main() {
  // The catalogue columns below are the ones the schema engine itself reads:
  //   19 / name : pg_class.relname, pg_attribute.attname, pg_type.typname
  //   18 / char : pg_attribute.attstorage, pg_attribute.attidentity
  // Nothing is cast to text: the driver receives the server's own types.
  const catalog = await client.$queryRaw`
    SELECT
      c.relname                AS relation_name,
      a.attname                AS column_name,
      t.typname                AS type_name,
      a.attstorage             AS storage,
      a.attidentity            AS identity,
      a.attnotnull             AS not_null
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE c.relname = 'companies'
      AND a.attname IN ('id', 'code', 'nameEn')
    ORDER BY a.attname
  `;

  if (catalog.length !== 3) {
    fail(`expected 3 catalog rows for the companies table, got ${catalog.length}`);
  }
  for (const row of catalog) {
    // OID 19 columns arrive as ordinary strings.
    if (typeof row.relation_name !== 'string' || row.relation_name !== 'companies') {
      fail(`OID 19 (name) column relname did not arrive as a string: ${JSON.stringify(row.relation_name)}`);
    }
    if (typeof row.column_name !== 'string' || typeof row.type_name !== 'string') {
      fail(`OID 19 (name) column arrived wrong: ${JSON.stringify(row)}`);
    }
    // OID 18 columns arrive as single-character strings.
    if (typeof row.storage !== 'string' || row.storage.length !== 1) {
      fail(`OID 18 (char) column attstorage did not arrive as one character: ${JSON.stringify(row.storage)}`);
    }
    if (typeof row.identity !== 'string' || row.identity.length !== 1) {
      fail(`OID 18 (char) column attidentity did not arrive as one character: ${JSON.stringify(row.identity)}`);
    }
    results.push({ column: row.column_name, type: row.type_name, storage: row.storage, identity: row.identity });
  }
  pass(`Prisma Client read ${catalog.length} catalog rows carrying OID 19 (name) and OID 18 (char)`);

  // The two OIDs describe themselves out of the catalog: pg_type.typname is OID
  // 19, so these rows are exactly the values an engine deserialises when it
  // fails with "column of type 'name'".
  const oids = await client.$queryRaw`
    SELECT oid, typname, typlen, typtype FROM pg_type WHERE oid IN (18, 19) ORDER BY oid
  `;
  if (oids.length !== 2) {
    fail(`expected the catalog to describe OIDs 18 and 19, got ${JSON.stringify(oids)}`);
  }
  const byName = Object.fromEntries(oids.map((row) => [row.typname, row]));
  if (!byName.char || !byName.name) {
    fail(`unexpected catalog names for OIDs 18/19: ${JSON.stringify(oids)}`);
  }
  if (byName.char.typlen !== 1) {
    fail(`OID 18 should be one byte wide, catalog says ${byName.char.typlen}`);
  }
  pass(`catalog describes OID 18 as "${byName.char.typname}" (1 byte) and OID 19 as "${byName.name.typname}"`);

  // NULLs are the half of the problem type checks never catch: an engine that
  // maps a null `name` to the string "null" corrupts its own metadata view.
  const nulls = await client.$queryRaw`
    SELECT
      NULL::"char" AS null_char,
      NULL::name   AS null_name,
      (SELECT attidentity FROM pg_attribute WHERE attrelid = 'companies'::regclass AND attname = 'id') AS real_char
  `;
  if (nulls[0].null_char !== null || nulls[0].null_name !== null) {
    fail(`a NULL char/name did not arrive as null: ${JSON.stringify(nulls[0])}`);
  }
  if (typeof nulls[0].real_char !== 'string' || nulls[0].real_char.length !== 1) {
    fail(`a real char value did not arrive as one character: ${JSON.stringify(nulls[0].real_char)}`);
  }
  pass('NULL values of OID 18 and OID 19 arrive as null, not as the string "null" or an empty string');

  // The `name` boundary: PostgreSQL truncates identifiers at NAMEDATALEN-1 = 63
  // bytes. Both directions are checked, because an engine sized for text instead
  // of name fails at exactly this edge.
  const boundary = await client.$queryRaw`
    SELECT
      length(repeat('a', 70)::name) AS truncated_length,
      repeat('b', 63)::name        AS exact_name
  `;
  if (Number(boundary[0].truncated_length) !== 63) {
    fail(`a 70-character name should be truncated to 63 by the server, got ${boundary[0].truncated_length}`);
  }
  if (typeof boundary[0].exact_name !== 'string' || boundary[0].exact_name.length !== 63) {
    fail(`a 63-character name did not survive intact: ${JSON.stringify(boundary[0].exact_name?.length)}`);
  }
  pass('a 63-character name survives intact and a 70-character name is truncated at the server boundary');

  // A long identifier is also exercised where it matters: a real table whose
  // name is at the limit, read back through the client.
  const longName = `kayan_${'x'.repeat(50)}`.slice(0, 63);
  await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${longName}"`);
  await client.$executeRawUnsafe(`CREATE TABLE "${longName}" (id int primary key)`);
  try {
    const found = await client.$queryRaw`
      SELECT c.relname FROM pg_class c WHERE c.oid = ${longName}::regclass
    `;
    if (found[0]?.relname !== longName) {
      fail(`a ${longName.length}-character table name did not read back unchanged`);
    }
    pass(`a ${longName.length}-character table name is created and read back unchanged through OID 19`);
  } finally {
    await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${longName}"`);
  }

  // Decimal money is not part of the OID question, but a client that mangles
  // types often mangles these too, so the same query path proves them.
  const money = await client.$queryRaw`SELECT 1234567890.1234::numeric(19,4) AS amount`;
  if (String(money[0].amount) !== '1234567890.1234') {
    fail(`DECIMAL(19,4) did not round-trip exactly: ${String(money[0].amount)}`);
  }
  pass('DECIMAL(19,4) money round-trips exactly through the same client');

  console.log('\nOID 18/19 summary (Prisma Client):');
  for (const row of results) {
    console.log(`  ${row.column}: type=${row.type} storage=${JSON.stringify(row.storage)} identity=${JSON.stringify(row.identity)}`);
  }
  console.log(
    '\nNote: this proves the *client* handles OID 18 and 19. It says nothing about the\n' +
      'migration engine, which is proven separately by prisma-native-migration-suite.mjs\n' +
      'running the native schema engine over the full migration history.',
  );
}

main()
  .catch((error) => {
    console.error(`::error title=OID 18/19::${error?.stack ?? error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect().catch(() => {});
  });
