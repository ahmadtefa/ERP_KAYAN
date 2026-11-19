/**
 * Adds any shipped role a database is missing, without starting the program.
 *
 * The program does this itself at start-up; this is the same pass on demand,
 * for an administrator who wants the roles on a database before the first
 * launch, and for the upgrade check that proves the pass is safe on data that
 * predates multi-role access.
 *
 *   DATABASE_URL=postgresql://… npx ts-node --transpile-only scripts/apply-role-catalogue.ts
 *
 * It only inserts what is absent. It never renames a role, never removes a
 * permission a company added, and never touches an assignment.
 */
import 'reflect-metadata';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { RoleCatalogueBootstrap } from '../src/modules/admin/role-catalogue.bootstrap';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const bootstrap = new RoleCatalogueBootstrap(prisma as never);
    const result = await bootstrap.ensureAllCompanies();
    console.log(
      `Role catalogue: ${result.created} role(s) added across ${result.companies} company(ies).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
