import { Prisma } from '@prisma/client';

/** Serialize chart hierarchy mutations performed by account editing and import.
 * All callers must obtain this before taking account row locks. This does not
 * protect direct SQL, restore/reset jobs, or other writers that bypass it. */
export async function lockChart(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM (
      SELECT pg_advisory_xact_lock(hashtextextended('kayan:chart:' || ${companyId}::text, 0))
    ) AS locked
  `);
}
