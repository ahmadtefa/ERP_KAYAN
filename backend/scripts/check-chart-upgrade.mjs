/**
 * Proves the required-accounts data upgrade (3103 opening-balance
 * equity, 5107 inventory differences) behaves for the three chart
 * shapes a real installation can be in, and that running it again
 * changes nothing.
 *
 * The database allows exactly one live company (partial unique
 * index), so the three shapes are exercised in sequence inside one
 * throwaway company on the isolated CI database: first an OLD chart
 * that predates both accounts, then the same chart edited into a
 * COMPLETE one with a renamed 3103 and a soft-deleted 5107, finally
 * a RENUMBERED chart whose '3'/'5' headings are gone. The company is
 * deleted afterwards whatever happens.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// The Prisma 7 client engine needs its driver adapter named
// explicitly — the same construction the API and the seed use.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

async function runMigration() {
  const dir = join(process.cwd(), 'prisma', 'migrations');
  const folder = (await readdir(dir)).find((name) =>
    name.endsWith('_chart_required_accounts_backfill'),
  );
  const sql = await readFile(join(dir, folder, 'migration.sql'), 'utf8');
  // Single statements only: comment lines are stripped first because
  // prose may contain semicolons of its own.
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

const stamp = Date.now().toString(36).toUpperCase();
let companyId = null;

const byCode = async () => {
  const rows = await prisma.account.findMany({ where: { companyId } });
  return new Map(rows.map((row) => [row.code, row]));
};
const countCode = async (code) =>
  prisma.account.count({ where: { companyId, code } });

try {
  const company = await prisma.company.create({
    data: {
      code: `UPG-${stamp}`,
      nameEn: `Upgrade check ${stamp}`,
      nameAr: `فحص ترقية ${stamp}`,
    },
  });
  companyId = company.id;

  const root = (code, type, nameEn, nameAr) => ({
    companyId,
    code,
    nameEn,
    nameAr,
    type,
    isPostable: false,
  });
  const postable = (code, type, nameEn, nameAr, parentId) => ({
    companyId,
    code,
    nameEn,
    nameAr,
    type,
    parentId,
  });

  // ---- Shape 1: an old chart that predates both accounts. ----
  const equity = await prisma.account.create({
    data: root('3', 'EQUITY', 'Equity', 'حقوق الملكية'),
  });
  const expense = await prisma.account.create({
    data: root('5', 'EXPENSE', 'Expenses', 'المصروفات'),
  });
  await prisma.account.create({
    data: postable('3101', 'EQUITY', 'Capital', 'رأس المال', equity.id),
  });
  await prisma.account.create({
    data: postable('5101', 'EXPENSE', 'Cost of sales', 'تكلفة المبيعات', expense.id),
  });
  const before = await byCode();
  const entriesBefore = await prisma.journalEntry.count({ where: { companyId } });

  await runMigration();
  await runMigration(); // twice: the second run must be a no-op

  let accounts = await byCode();
  const opening = accounts.get('3103');
  const difference = accounts.get('5107');
  check('old chart gains 3103 exactly once', (await countCode('3103')) === 1);
  check('old chart gains 5107 exactly once', (await countCode('5107')) === 1);
  check(
    '3103 is a postable EQUITY account under heading 3',
    opening?.type === 'EQUITY' && opening.isPostable && opening.parentId === equity.id,
  );
  check(
    '5107 is a postable EXPENSE account under heading 5',
    difference?.type === 'EXPENSE' && difference.isPostable && difference.parentId === expense.id,
  );
  check(
    'names match the application template (EN + AR)',
    opening?.nameEn === 'Opening balance equity' &&
      opening?.nameAr === 'أرصدة افتتاحية' &&
      difference?.nameEn === 'Inventory differences' &&
      difference?.nameAr === 'فروق جرد المخزون',
  );
  check(
    'pre-existing accounts are the very same rows',
    ['3', '5', '3101', '5101'].every(
      (code) => accounts.get(code)?.id === before.get(code)?.id,
    ),
  );
  check(
    'the upgrade bookkept nothing: no journal entries appeared',
    (await prisma.journalEntry.count({ where: { companyId } })) === entriesBefore,
  );

  // ---- Shape 2: complete chart, locally renamed + retired. ----
  await prisma.account.update({
    where: { id: opening.id },
    data: { nameEn: 'Owner opening balances (custom)' },
  });
  await prisma.account.update({
    where: { id: difference.id },
    data: { deletedAt: new Date() },
  });

  await runMigration();

  accounts = await byCode();
  check(
    'a renamed 3103 keeps the owner’s name (never overwritten)',
    accounts.get('3103')?.nameEn === 'Owner opening balances (custom)',
  );
  check(
    'a soft-deleted 5107 is not revived or duplicated',
    (await countCode('5107')) === 1 && accounts.get('5107')?.deletedAt !== null,
  );

  // ---- Shape 3: renumbered chart, the '3'/'5' headings gone. ----
  await prisma.account.updateMany({
    where: { companyId },
    data: { parentId: null },
  });
  await prisma.account.deleteMany({
    where: { companyId, code: { in: ['3103', '5107', '3', '5'] } },
  });

  await runMigration();

  accounts = await byCode();
  check(
    'renumbered chart still gains both accounts, parentless',
    (await countCode('3103')) === 1 &&
      (await countCode('5107')) === 1 &&
      accounts.get('3103')?.parentId === null &&
      accounts.get('5107')?.parentId === null,
  );
  check(
    'types stay correct without the headings',
    accounts.get('3103')?.type === 'EQUITY' && accounts.get('5107')?.type === 'EXPENSE',
  );
} finally {
  if (companyId) {
    // Unparent first: the self-reference is Restrict, so deleting a
    // heading while its children still point at it could fail.
    await prisma.account.updateMany({
      where: { companyId },
      data: { parentId: null },
    });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  }
  await prisma.$disconnect();
}

console.log(
  failures === 0
    ? 'chart-upgrade checks: all passed'
    : `chart-upgrade checks: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
