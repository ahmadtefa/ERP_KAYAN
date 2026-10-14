import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BranchKind, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateBranchDto,
  UpdateBranchDto,
  UpdateCompanyProfileDto,
} from './dto/company.dto';

/// The company profile: what the business calls itself, how it can be
/// reached, and the optional logo that reports and the shell show.
///
/// Multi-company isolation is preserved throughout: every read and write is
/// scoped to the caller's companyId, which comes from the verified token and
/// never from a query parameter.

/// Logo rules. The size and the types are deliberately small: the logo is
/// shown next to numbers, not designed on. Anything else is refused before it
/// touches the database.
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES: Record<string, { mime: string; magic: number[][] }> = {
  'image/png': { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/jpeg': { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  'image/webp': {
    mime: 'image/webp',
    magic: [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP checked below
  },
};

export interface BranchResponse {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  kind: 'HEADQUARTERS' | 'BRANCH';
  parentBranchId: string | null;
  isActive: boolean;
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /// ────────────────────────────────────────────────────────────── profile

  async getProfile(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Company not found');
    }
    return {
      id: company.id,
      code: company.code,
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      taxId: company.taxId,
      currency: company.currency,
      timezone: company.timezone,
      phone: company.phone,
      email: company.email,
      address: company.address,
      hasLogo: (company.logoData?.length ?? 0) > 0,
      logoMime: company.logoData ? company.logoMime : null,
      logoBase64: company.logoData ? Buffer.from(company.logoData).toString('base64') : null,
      isActive: company.isActive,
    };
  }

  async updateProfile(
    companyId: string,
    userId: string,
    dto: UpdateCompanyProfileDto,
  ) {
    const before = await this.getProfile(companyId);

    if (dto.code !== undefined && dto.code !== before.code) {
      const clash = await this.prisma.company.findFirst({
        where: { code: dto.code, id: { not: companyId } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `Another company already uses the code "${dto.code}"`,
        );
      }
    }

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        taxId: dto.taxId,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'companies',
      entityId: companyId,
      before,
      after: {
        code: updated.code,
        nameEn: updated.nameEn,
        nameAr: updated.nameAr,
        phone: updated.phone,
        email: updated.email,
        address: updated.address,
      },
    });

    return this.getProfile(companyId);
  }

  /// ──────────────────────────────────────────────────────────────── logo

  async setLogo(
    companyId: string,
    userId: string,
    data: Buffer,
    mime: string,
  ): Promise<{ hasLogo: true; logoMime: string }> {
    const checked = validateLogo(data, mime);
    const size = checked.data.length;

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        logoData: checked.data,
        logoMime: checked.mime,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'companies',
      entityId: companyId,
      // The bytes themselves are not audited — only that the logo changed.
      after: { logo: checked.mime, size },
    });

    return { hasLogo: true, logoMime: checked.mime };
  }

  async getLogo(
    companyId: string,
  ): Promise<{ data: Buffer; mime: string } | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { logoData: true, logoMime: true },
    });
    if (!company?.logoData?.length) return null;
    return { data: Buffer.from(company.logoData), mime: company.logoMime ?? 'image/png' };
  }

  async deleteLogo(companyId: string, userId: string): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { logoData: null, logoMime: null, updatedBy: userId },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'companies',
      entityId: companyId,
      after: { logo: null },
    });
  }

  /// ────────────────────────────────────────────────────────────── branches

  async listBranches(companyId: string): Promise<BranchResponse[]> {
    const rows = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toBranchResponse);
  }

  /**
   * Creates a headquarters or a branch.
   *
   * A branch is always attached to a parent unit: either the one named in the
   * request or, when none is named, the company's headquarters. A company may
   * have exactly one headquarters, so "another headquarters" is refused rather
   * than silently demoting the first one.
   */
  async createBranch(
    companyId: string,
    userId: string,
    dto: CreateBranchDto,
  ): Promise<BranchResponse> {
    const kind: BranchKind = dto.kind ?? 'BRANCH';

    const clash = await this.prisma.branch.findFirst({
      where: { companyId, code: dto.code, deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `Branch code "${dto.code}" already exists in this company`,
      );
    }

    if (kind === 'HEADQUARTERS') {
      const existingHq = await this.prisma.branch.findFirst({
        where: { companyId, kind: 'HEADQUARTERS', deletedAt: null },
        select: { id: true, code: true },
      });
      if (existingHq) {
        throw new ConflictException(
          `This company already has a headquarters (code "${existingHq.code}"). ` +
            'A company has exactly one headquarters.',
        );
      }
    }

    const parentBranchId = await this.resolveParent(
      companyId,
      kind,
      dto.parentBranchId ?? null,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          companyId,
          code: dto.code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          kind,
          parentBranchId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // Every branch can hold stock, so every branch arrives with the one
      // warehouse that makes "where are these goods?" answerable from its
      // first day rather than its first document.
      await tx.warehouse.create({
        data: {
          companyId,
          branchId: branch.id,
          code: `${branch.code}-MAIN`,
          nameEn: `${branch.nameEn} main store`,
          nameAr: `${branch.nameAr} - المخزن الرئيسي`,
          isDefault: true,
          createdBy: userId,
        },
      });

      return branch;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'branches',
      entityId: created.id,
      after: {
        code: created.code,
        kind: created.kind,
        parentBranchId: created.parentBranchId,
      },
    });

    return toBranchResponse(created);
  }

  async updateBranch(
    companyId: string,
    userId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ): Promise<BranchResponse> {
    const branch = await this.findBranch(companyId, branchId);

    if (dto.kind === 'HEADQUARTERS' && branch.kind !== 'HEADQUARTERS') {
      const otherHq = await this.prisma.branch.findFirst({
        where: {
          companyId,
          kind: 'HEADQUARTERS',
          deletedAt: null,
          id: { not: branchId },
        },
        select: { code: true },
      });
      if (otherHq) {
        throw new ConflictException(
          `This company already has a headquarters (code "${otherHq.code}")`,
        );
      }
    }

    // A headquarters stands at the top of its tree: giving it a parent would
    // make the relationship circular by construction.
    if (dto.kind === 'HEADQUARTERS' || branch.kind === 'HEADQUARTERS') {
      if (dto.parentBranchId) {
        throw new BadRequestException(
          'The headquarters cannot have a parent unit',
        );
      }
    }

    let parentBranchId: string | null | undefined;
    if (dto.parentBranchId !== undefined) {
      parentBranchId = await this.resolveParent(
        companyId,
        dto.kind ?? branch.kind,
        dto.parentBranchId,
        branchId,
      );
    }

    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        kind: dto.kind,
        isActive: dto.isActive,
        parentBranchId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'branches',
      entityId: branchId,
      before: toBranchResponse(branch),
      after: toBranchResponse(updated),
    });

    return toBranchResponse(updated);
  }

  /**
   * Soft-deletes a branch. A unit that already carries documents or people is
   * never deleted: those rows point at it. Deactivate it instead — the books
   * keep their history and the branch disappears from new documents.
   */
  async deleteBranch(
    companyId: string,
    userId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.findBranch(companyId, branchId);

    const [children, entries, stock, users] = await Promise.all([
      this.prisma.branch.count({
        where: { parentBranchId: branchId, deletedAt: null },
      }),
      this.prisma.journalEntry.count({ where: { branchId } }),
      this.prisma.stockMovement.count({ where: { branchId } }),
      this.prisma.userBranch.count({ where: { branchId } }),
    ]);

    if (children > 0) {
      throw new BadRequestException(
        'This unit has sub-units under it. Move or delete them first.',
      );
    }
    if (entries > 0 || stock > 0) {
      throw new BadRequestException(
        'This unit already has accounting or stock movements. ' +
          'Deactivate it instead of deleting it so the history stays intact.',
      );
    }
    if (users > 0) {
      throw new BadRequestException(
        'Users are still assigned to this unit. Unassign them first.',
      );
    }

    await this.prisma.branch.update({
      where: { id: branchId },
      data: { deletedAt: new Date(), updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'branches',
      entityId: branchId,
      before: toBranchResponse(branch),
    });
  }

  /// ────────────────────────────────────────────────────────────── helpers

  private async findBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  /**
   * Works out which unit a new or moved branch hangs from, and refuses every
   * arrangement that would be wrong: a parent in another company, a parent
   * that does not exist, the branch itself, or an arrangement that would close
   * a circle (making the branch its own ancestor).
   */
  private async resolveParent(
    companyId: string,
    kind: BranchKind,
    requested: string | null,
    selfId?: string,
  ): Promise<string | null> {
    if (kind === 'HEADQUARTERS') {
      if (requested) {
        throw new BadRequestException(
          'The headquarters cannot have a parent unit',
        );
      }
      return null;
    }

    if (requested) {
      if (selfId && requested === selfId) {
        throw new BadRequestException('A unit cannot be its own parent');
      }
      const parent = await this.prisma.branch.findFirst({
        where: { id: requested, companyId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException(
          'The parent unit does not exist in this company',
        );
      }
      // Walk up from the proposed parent: if we ever reach selfId, the new
      // link would close a circle.
      if (selfId) {
        let cursor: string | null = parent.parentBranchId;
        const seen = new Set<string>([parent.id]);
        while (cursor) {
          if (cursor === selfId) {
            throw new BadRequestException(
              'This would make the unit its own ancestor. Choose another parent.',
            );
          }
          if (seen.has(cursor)) break; // database already inconsistent; stop
          seen.add(cursor);
          const next: { parentBranchId: string | null } | null =
            await this.prisma.branch.findUnique({
              where: { id: cursor },
              select: { parentBranchId: true },
            });
          cursor = next?.parentBranchId ?? null;
        }
      }
      return parent.id;
    }

    // No parent named: attach to the headquarters when there is one.
    const hq = await this.prisma.branch.findFirst({
      where: { companyId, kind: 'HEADQUARTERS', deletedAt: null },
      select: { id: true },
    });
    if (hq) return hq.id;

    throw new BadRequestException(
      'A branch needs a parent unit. Create the headquarters first, or name the parent explicitly.',
    );
  }
}

function toBranchResponse(row: {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  kind: BranchKind;
  parentBranchId: string | null;
  isActive: boolean;
}): BranchResponse {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    kind: row.kind,
    parentBranchId: row.parentBranchId,
    isActive: row.isActive,
  };
}

/**
 * Checks an uploaded logo: right type, right size, and the bytes actually
 * match the claimed type (a .png that is really a script is refused here).
 */
export function validateLogo(
  data: Buffer,
  mime: string,
): { data: Uint8Array<ArrayBuffer>; mime: string } {
  const normalised = (mime ?? '').split(';')[0].trim().toLowerCase();
  const spec = LOGO_TYPES[normalised];
  if (!spec) {
    throw new BadRequestException(
      'The logo must be a PNG, JPEG or WebP image.',
    );
  }
  if (data.length === 0) {
    throw new BadRequestException('The logo file is empty.');
  }
  if (data.length > LOGO_MAX_BYTES) {
    throw new BadRequestException(
      `The logo is larger than ${Math.round(LOGO_MAX_BYTES / 1024 / 1024)} MB.`,
    );
  }
  const matches = spec.magic.some((signature) =>
    signature.every((byte, index) => data[index] === byte),
  );
  if (!matches) {
    throw new BadRequestException(
      'The file content does not match its type. Choose a real PNG, JPEG or WebP image.',
    );
  }
  if (normalised === 'image/webp') {
    // RIFF container: bytes 8-11 must read WEBP.
    const tag = data.subarray(8, 12).toString('latin1');
    if (tag !== 'WEBP') {
      throw new BadRequestException('The file is not a real WebP image.');
    }
  }
  // Prisma's Bytes column wants a Uint8Array; same bytes, right type.
  return { data: Uint8Array.from(data), mime: normalised };
}
