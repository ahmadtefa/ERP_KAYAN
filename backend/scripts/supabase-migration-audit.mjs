import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rules = [
  ['ROLE_DATABASE_OR_SCHEMA_DDL', /\\b(?:CREATE|ALTER|DROP)\\s+(?:ROLE|USER|DATABASE|SCHEMA)\\b/i],
  ['EXTENSION_DDL_REQUIRES_REVIEW', /\\b(?:CREATE|ALTER|DROP)\\s+EXTENSION\\b/i],
  ['DESTRUCTIVE_DDL', /\\bDROP\\s+(?:TABLE|COLUMN|SCHEMA)\\b|\\bALTER\\s+TABLE\\b[^;]*\\bDROP\\s+COLUMN\\b|\\bTRUNCATE\\b|\\bDELETE\\s+FROM\\b/i],
  ['UNSUPPORTED_OR_PRIVILEGED_POSTGRES_COMMAND', /\\bALTER\\s+SYSTEM\\b|\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+CONCURRENTLY\\b|\\bDROP\\s+INDEX\\s+CONCURRENTLY\\b|\\bSET\\s+ROLE\\b|\\bCREATE\\s+EVENT\\s+TRIGGER\\b|\\bCOPY\\b[^;]*\\bPROGRAM\\b/i],
  ['SUPABASE_MANAGED_SCHEMA_REFERENCE', /\\b(?:auth|storage)\\s*\\./i],
  ['SECURITY_DEFINER_REQUIRES_REVIEW', /\\bSECURITY\\s+DEFINER\\b/i],
];

function withoutComments(sql) {
  return sql
    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ')
    .replace(/^\\s*--.*$/gm, ' ');
}

export function auditMigrationSql(name, sql) {
  const source = withoutComments(sql);
  const findings = [];
  for (const [code, pattern] of rules) {
    const match = pattern.exec(source);
    if (match) findings.push({ migration: name, code, excerpt: match[0].replace(/\\s+/g, ' ').slice(0, 100) });
  }
  return findings;
}

export async function auditMigrationDirectory(directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const migrations = [];
  const violations = [];
  let policyMigrations = 0;
  let dataBackfills = 0;

  for (const name of entries) {
    const file = join(directory, name, 'migration.sql');
    let sql;
    try {
      sql = await readFile(file, 'utf8');
    } catch {
      violations.push({ migration: name, code: 'MISSING_MIGRATION_SQL', excerpt: file });
      continue;
    }
    migrations.push(name);
    violations.push(...auditMigrationSql(name, sql));
    if (/\\bCREATE\\s+POLICY\\b/i.test(withoutComments(sql))) policyMigrations += 1;
    dataBackfills += [...withoutComments(sql).matchAll(/\\bUPDATE\\s+[\\"\\w]/gi)].length;
  }

  return { migrations, violations, policyMigrations, dataBackfills };
}

async function main() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const migrationDirectory = join(here, '..', 'prisma', 'migrations');
  const result = await auditMigrationDirectory(migrationDirectory);
  if (result.violations.length) {
    for (const item of result.violations) {
      console.error(`FAIL ${item.migration} [${item.code}]: ${item.excerpt}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: scanned ${result.migrations.length} Prisma migration files; no forbidden role/database DDL, destructive DDL, or known Supabase-incompatible commands.`);
  console.log(`Reviewed ${result.dataBackfills} data UPDATE statements; no DROP, DELETE, or TRUNCATE statements found.`);
  if (result.policyMigrations === 0) {
    console.warn('CLOUD BLOCKER: no Prisma migration creates tenant RLS policies. The Supabase RLS event trigger only enables RLS; do not grant runtime table access until tenant policies are implemented and verified.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
