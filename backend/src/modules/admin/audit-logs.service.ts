import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ListAuditLogsDto } from './dto/audit-log.dto';

/**
 * Reads the audit trail written by AuditService.
 *
 * The trail is append-only: nothing here creates, edits or deletes a record,
 * and it is scoped to the reader's own company.
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, query: ListAuditLogsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: Prisma.AuditLogWhereInput = {
      companyId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { username: true, fullNameEn: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        userId: row.userId,
        username: row.user?.username ?? null,
        userFullName: row.user?.fullNameEn ?? null,
        before: row.beforeJson ?? null,
        after: row.afterJson ?? null,
        ipAddress: row.ipAddress,
      })),
      total,
      page,
      pageSize,
    };
  }
}
