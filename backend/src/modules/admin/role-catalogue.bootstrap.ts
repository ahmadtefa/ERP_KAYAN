import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PERMISSIONS } from '../../../prisma/permissions';
import { seededRoles } from '../../../prisma/role-catalogue';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Gives every company the roles the program is supposed to ship with.
 *
 * The development seed only helps a database that is created from scratch. A
 * real installation is years old: it has ADMIN and ACCOUNTANT and nothing else,
 * and its users, passwords, photos and documents must survive the upgrade
 * untouched. This runs once at start-up and adds only what is missing — it
 * never removes a permission a company added, never renames a role, never
 * touches an assignment. Running it twice changes nothing.
 *
 * It is also what makes the migration safe on a populated database: the schema
 * migration adds the columns, this adds the roles, and neither needs the other
 * to be run by hand.
 */
@Injectable()
export class RoleCatalogueBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleCatalogueBootstrap.name);
  private inFlight: Promise<{ created: number; companies: number }> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    // Start-up must never fail because a role could not be created: a missing
    // convenience role is a smaller problem than a program that will not open.
    void this.ensureAllCompanies().catch((error: unknown) => {
      this.logger.warn(
        `Role catalogue could not be applied at start-up: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /// Adds any missing catalogue role to every company. The manual sync
  /// endpoint calls this too, so two calls at once share one pass.
  ensureAllCompanies(): Promise<{ created: number; companies: number }> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.ensure().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ensure(): Promise<{ created: number; companies: number }> {
    const permissions = await this.prisma.permission.findMany({
      select: { id: true, code: true },
    });
    // A database whose permission catalogue has not been seeded yet is left
    // alone: creating eighteen roles that grant nothing would be worse than
    // creating them on the next start, after the catalogue is there.
    if (permissions.length === 0) {
      this.logger.log('Role catalogue skipped: the permission catalogue is empty');
      return { created: 0, companies: 0 };
    }
    const permissionIdByCode = new Map(permissions.map((row) => [row.code, row.id]));
    const codes = PERMISSIONS.map(([code]) => code);
    const definitions = seededRoles(codes);
    const companies = await this.prisma.company.findMany({ select: { id: true } });

    let created = 0;
    for (const company of companies) {
      const existing = await this.prisma.role.findMany({
        where: { companyId: company.id },
        select: { code: true, deletedAt: true },
      });
      const taken = new Set(existing.map((row) => row.code));
      for (const definition of definitions) {
        if (taken.has(definition.code)) continue;
        const permissionIds = definition.permissions
          .map((code) => permissionIdByCode.get(code))
          .filter((id): id is string => Boolean(id));
        try {
          await this.prisma.role.create({
            data: {
              companyId: company.id,
              code: definition.code,
              nameEn: definition.nameEn,
              nameAr: definition.nameAr,
              descriptionEn: definition.descriptionEn,
              descriptionAr: definition.descriptionAr,
              category: definition.category,
              isSystem: true,
              rolePermissions: {
                create: permissionIds.map((permissionId) => ({ permissionId })),
              },
            },
          });
          created += 1;
        } catch (error) {
          // Two instances starting at once: the second one's insert loses the
          // race, which is exactly the outcome it wanted anyway.
          if (
            error instanceof Error &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
          ) {
            continue;
          }
          throw error;
        }
      }
    }
    if (created > 0) {
      this.logger.log(
        `Role catalogue: added ${created} role(s) across ${companies.length} company(ies)`,
      );
    }
    return { created, companies: companies.length };
  }
}
