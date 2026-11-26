import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Allocates authoritative document numbers.
 *
 * The numbering is server-side by design: a client-generated number can
 * collide across devices and cannot be trusted for audit purposes. Allocation
 * runs inside the caller's transaction and takes a row lock on the counter,
 * so two concurrent requests for the same company serialise instead of
 * receiving the same number.
 */
@Injectable()
export class DocumentNumberService {
  /**
   * Reserves the next number for [key] within an existing transaction.
   * Must be called inside a transaction so the number is rolled back with
   * the document that failed to save.
   */
  async next(
    tx: Prisma.TransactionClient,
    companyId: string,
    key: string,
    prefix: string,
  ): Promise<string> {
    // The counter row nearly always exists, so take the number first and
    // create the row only when there was none. Creating it up front (as this
    // used to) made every request wait behind the one that held the row.
    const take = () => tx.$queryRaw<Array<{ nextValue: number; prefix: string }>>`
      UPDATE document_sequences
         SET "nextValue" = "nextValue" + 1, "updatedAt" = now()
       WHERE "companyId" = ${companyId}::uuid AND key = ${key}
      RETURNING "nextValue", prefix
    `;
    // The UPDATE locks the row until the transaction commits, which is what
    // makes concurrent allocation safe.
    let rows = await take();
    if (rows.length === 0) {
      await tx.$executeRaw`
        INSERT INTO document_sequences ("companyId", key, prefix, "nextValue", "updatedAt")
        VALUES (${companyId}::uuid, ${key}, ${prefix}, 1, now())
        ON CONFLICT ("companyId", key) DO NOTHING
      `;
      rows = await take();
    }

    const row = rows[0];
    const allocated = row.nextValue - 1;
    return `${row.prefix}-${String(allocated).padStart(6, '0')}`;
  }
}
