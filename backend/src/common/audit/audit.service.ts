import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Writes the append-only audit trail.
 *
 * record() is best-effort for legacy callers. Security-critical callers should
 * use recordRequired() inside the same database transaction as their mutation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.recordRequired(input, this.prisma);
    } catch (error) {
      this.logger.error(
        `Failed to write audit record for ${input.action} ${input.entity}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Write within a caller-owned transaction; failures must abort that transaction. */
  async recordRequired(
    input: AuditInput,
    transaction: Pick<Prisma.TransactionClient, 'auditLog'>,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        companyId: input.companyId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        beforeJson: (input.before ?? undefined) as never,
        afterJson: (input.after ?? undefined) as never,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

}
