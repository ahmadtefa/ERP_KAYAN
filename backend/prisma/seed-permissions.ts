/**
 * Writes the permission catalogue, and nothing else.
 *
 * The demo data builder needs a database that has the permissions in it but
 * no company yet, which is exactly what the development seed cannot give it
 * (the seed insists on creating a company). One small script, so the demo
 * database can be built from nothing in one command.
 *
 * Safe to run at any time: every row is an upsert.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { PERMISSIONS } from './permissions';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  for (const [code, nameEn, nameAr, module] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { nameEn, nameAr, module },
      create: { code, nameEn, nameAr, module },
    });
  }
  console.log(`Permission catalogue ready: ${PERMISSIONS.length} permissions.`);
}

main()
  .catch((error) => {
    console.error('The permission catalogue could not be written:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
