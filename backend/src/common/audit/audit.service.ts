import { Injectable, Logger } from '@nestjs/common';
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
 * Audit failures are logged but never propagated: a bookkeeping problem must
 * not abort a legitimate business operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
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
    } catch (error) {
      this.logger.error(
        `Failed to write audit record for ${input.action} ${input.entity}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
