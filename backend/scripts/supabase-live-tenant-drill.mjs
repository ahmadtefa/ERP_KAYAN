import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { parseAndValidate, secureClientOptions } from './check-supabase-roles.mjs';

const runtime = parseAndValidate(
  'SUPABASE_DATABASE_URL',
  process.env.SUPABASE_DATABASE_URL,
  'runtime',
);
const client = new Client(secureClientOptions(runtime.connectionString));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function setContext(name, value) {
  await client.query('SELECT set_config($1, $2, true)', [name, value]);
}

async function count(table, ids, column = 'id') {
  const result = await client.query(
    `SELECT count(*)::int AS n FROM public.${table} WHERE ${column} = ANY($1::uuid[])`,
    [ids],
  );
  return result.rows[0].n;
}

async function main() {
  await client.connect();
  let inTransaction = false;
  try {
    const role = await client.query(
      'SELECT current_user AS role, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
    );
    assert(role.rowCount === 1, 'Could not inspect runtime role.');
    const r = role.rows[0];
    assert(
      !r.rolsuper && !r.rolbypassrls && !r.rolcreatedb && !r.rolcreaterole,
      'Runtime role is not sufficiently restricted.',
    );
    assert(r.role === runtime.role, 'Connected role does not match the dedicated runtime role.');

    const companyA = randomUUID();
    const companyB = randomUUID();
    const branchA = randomUUID();
    const branchB = randomUUID();
    const suffix = randomUUID();

    await client.query('BEGIN');
    inTransaction = true;
    await setContext('app.setup_mode', '1');
    await client.query(
      `INSERT INTO public.companies (id, code, "nameEn", "nameAr", "isActive", "updatedAt")
       VALUES ($1, $2, $3, $4, true, now()), ($5, $6, $7, $8, false, now())`,
      [companyA, `CI-A-${suffix}`, 'KAYAN isolated test A', 'اختبار عزل أ',
       companyB, `CI-B-${suffix}`, 'KAYAN isolated test B', 'اختبار عزل ب'],
    );
    await setContext('app.setup_mode', '0');

    await setContext('app.company_id', companyA);
    await client.query(
      `INSERT INTO public.branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
       VALUES ($1, $2, $3, 'Test Branch A', 'فرع اختبار أ', now())`,
      [branchA, companyA, `BR-A-${suffix}`],
    );
    assert(await count('companies', [companyA, companyB]) === 1, 'Company A can see another company.');
    assert(await count('branches', [branchA, branchB]) === 1, 'Company A can see another company branch.');

    await client.query('SAVEPOINT cross_company_write');
    let crossWriteDenied = false;
    try {
      await client.query(
        `INSERT INTO public.branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
         VALUES ($1, $2, $3, 'Forbidden Branch', 'فرع ممنوع', now())`,
        [randomUUID(), companyB, `DENIED-${suffix}`],
      );
    } catch (error) {
      crossWriteDenied = error?.code === '42501' || error?.code === '23514';
      await client.query('ROLLBACK TO SAVEPOINT cross_company_write');
    }
    await client.query('RELEASE SAVEPOINT cross_company_write');
    assert(crossWriteDenied, 'Runtime was able to write a child row for another company.');

    await setContext('app.company_id', companyB);
    await client.query(
      `INSERT INTO public.branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
       VALUES ($1, $2, $3, 'Test Branch B', 'فرع اختبار ب', now())`,
      [branchB, companyB, `BR-B-${suffix}`],
    );
    assert(await count('companies', [companyA, companyB]) === 1, 'Company B can see another company.');
    assert(await count('branches', [branchA, branchB]) === 1, 'Company B can see another company branch.');

    await client.query('ROLLBACK');
    inTransaction = false;
    const cleared = await client.query('SELECT public.app_company_id() IS NULL AS cleared');
    assert(cleared.rows[0].cleared, 'Tenant context leaked after transaction rollback.');
    console.log('PASS live Supabase RLS: dedicated runtime role; two-company read/write isolation; tenant context cleared; test rows rolled back.');
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Live Supabase tenant isolation test failed.');
  process.exitCode = 1;
});
