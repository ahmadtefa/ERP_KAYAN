#!/usr/bin/env node
/**
 * Proves the 3103/5107 chart backfill on real PostgreSQL:
 *
 *   node backend/scripts/check-chart-upgrade.mjs
 *
 * Three throwaway companies — one created the old way (chart without
 * the two required accounts), one that already has them, one whose
 * '3' heading was renumbered away — then the migration SQL itself is
 * executed twice. Afterwards: exactly one of each account per
 * company, the pre-existing ones untouched (same ids), correct
 * type/names/parent, and not a single journal line created. The
 * script deletes everything it made, pass or fail, and never touches
 * a company it did not create.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const stamp = String(Date.now()).slice(-8);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
const dir = readdirSync(migrationsDir).find((d) => d.endsWith('chart_required_accounts_backfill'));
// One statement per raw call (comments stripped first — they may
// contain semicolons of their own).
const statements = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
const runMigration = async () => {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
};

const root = (companyId, code, nameEn, nameAr, type) => ({
  companyId, code, nameEn, nameAr, type, isPostable: false,
});
const leaf = (companyId, code, nameEn, nameAr, type, parentId) => ({
  companyId, code, nameEn, nameAr, type, isPostable: true, parentId,
});

const companyIds = [];
try {
  // Company A: created before the fix — headings exist, 3103/5107 do not.
  const a = await prisma.company.create({
    data: { code: `UPGA-${stamp}`, nameEn: 'Upgrade A', nameAr: 'ترقية أ' },
  });
  companyIds.push(a.id);
  const aEquity = await prisma.account.create({ data: root(a.id, '3', 'Equity', 'حقوق الملكية', 'EQUITY') });
  const aExpense = await prisma.account.create({ data: root(a.id, '5', 'Expenses', 'المصروفات', 'EXPENSE') });

  // Company B: already complete — the upgrade must be a no-op for it.
  const b = await prisma.company.create({
    data: { code: `UPGB-${stamp}`, nameEn: 'Upgrade B', nameAr: 'ترقية ب' },
  });
  companyIds.push(b.id);
  const bEquity = await prisma.account.create({ data: root(b.id, '3', 'Equity', 'حقوق الملكية', 'EQUITY') });
  const bExpense = await prisma.account.create({ data: root(b.id, '5', 'Expenses', 'المصروفات', 'EXPENSE') });
  const bOpening = await prisma.account.create({
    data: leaf(b.id, '3103', 'Opening balance equity', 'أرصدة افتتاحية', 'EQUITY', bEquity.id),
  });
  const bDifference = await prisma.account.create({
    data: leaf(b.id, '5107', 'Inventory differences', 'فروق المخزون', 'EXPENSE', bExpense.id),
  });

  // Company C: renumbered chart — no '3' heading to parent under.
  const c = await prisma.company.create({
    data: { code: `UPGC-${stamp}`, nameEn: 'Upgrade C', nameAr: 'ترقية ج' },
  });
  companyIds.push(c.id);
  await prisma.account.create({ data: root(c.id, '5', 'Expenses', 'المصروفات', 'EXPENSE') });

  // The migration, twice: the second run must change nothing.
  await runMigration();
  await runMigration();

  const byCompany = async (companyId) =>
    prisma.account.findMany({
      where: { companyId, code: { in: ['3103', '5107'] } },
      orderBy: { code: 'asc' },
    });

  const aRows = await byCompany(a.id);
  check(
    'an old company gains exactly one 3103 and one 5107',
    aRows.length === 2 &&
      aRows.filter((r) => r.code === '3103').length === 1 &&
      aRows.filter((r) => r.code === '5107').length === 1,
    `rows ${aRows.map((r) => r.code).join(',')}`,
  );
  const aOpening = aRows.find((r) => r.code === '3103');
  const aDifference = aRows.find((r) => r.code === '5107');
  check(
    'with the mapped names, types and parents',
    aOpening?.type === 'EQUITY' && aOpening.parentId === aEquity.id &&
      aOpening.nameEn === 'Opening balance equity' && aOpening.isPostable &&
      aDifference?.type === 'EXPENSE' && aDifference.parentId === aExpense.id &&
      aDifference.nameEn === 'Inventory differences' && aDifference.isPostable,
    `3103 parent ${aOpening?.parentId === aEquity.id}, 5107 parent ${aDifference?.parentId === aExpense.id}`,
  );

  const bRows = await byCompany(b.id);
  check(
    'a complete company is untouched (same rows, no duplicates)',
    bRows.length === 2 &&
      bRows.find((r) => r.code === '3103')?.id === bOpening.id &&
      bRows.find((r) => r.code === '5107')?.id === bDifference.id,
    `rows ${bRows.length}`,
  );

  const cRows = await byCompany(c.id);
  check(
    'a renumbered chart gets the accounts top-level instead of a broken parent',
    cRows.length === 2 && cRows.find((r) => r.code === '3103')?.parentId === null,
    `3103 parent ${cRows.find((r) => r.code === '3103')?.parentId}`,
  );

  const lines = await prisma.journalLine.count({
    where: { accountId: { in: [...aRows, ...bRows, ...cRows].map((r) => r.id) } },
  });
  check('no journal line was created by adding accounts', lines === 0, `lines ${lines}`);
} finally {
  await prisma.account.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.$disconnect();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} chart-upgrade checks passed`);
process.exit(failed === 0 ? 0 : 1);
