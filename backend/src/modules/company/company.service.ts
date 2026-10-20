import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BranchKind } from '@prisma/client';
import { readFile, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp, { type Metadata } from 'sharp';

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
export const LOGO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const LOGO_MAX_PIXELS = 16_000_000;
const LOGO_MAX_DIMENSION = 1024;
export const LOGO_TYPES: Record<string, { mime: string; magic: number[][] }> = {
  'image/png': { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/jpeg': { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  'image/webp': {
    mime: 'image/webp',
    magic: [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP checked below
  },
};

/// Multipart libraries may default a byte-backed upload to
/// `application/octet-stream`. When that happens, infer a candidate from the
/// filename; validateLogo still checks the actual image signature, so an
/// extension can never make non-image bytes acceptable.
export function logoMimeForUpload(mime: string, fileName: string): string {
  const normalized = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (LOGO_TYPES[normalized]) return normalized;
  const byExtension: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  return byExtension[extname(fileName ?? '').toLowerCase()] ?? normalized;
}

export interface BranchResponse {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  kind: 'HEADQUARTERS' | 'BRANCH';
  parentBranchId: string | null;
  isActive: boolean;
}

/// Directory where logos uploaded by earlier versions (file-based `logoPath`)
/// are kept. New logos are stored in the database and do not use it.
export function uploadsDir(): string {
  return process.env.KAYAN_UPLOAD_DIR ?? join(process.cwd(), 'uploads');
}

const LEGACY_LOGO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

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
    return this.toProfile(company);
  }

  /// Kept for the existing `/companies/profile` contract.
  profile(companyId: string) {
    return this.getProfile(companyId);
  }

  /// Public branding (no sign-in): the first active company, or the defaults
  /// when the installation has no company yet.
  async publicBranding() {
    const company = await this.defaultCompany();
    if (!company) {
      return { nameEn: 'KAYAN ERP', nameAr: 'نظام كيان', logoUrl: null };
    }
    return {
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      logoUrl: this.logoUrl(company),
    };
  }

  async brandingFor(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');
    return {
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      logoUrl: this.logoUrl(company),
    };
  }

  async updateProfile(
    companyId: string,
    userId: string,
    dto: UpdateCompanyProfileDto,
  ) {
    const before = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!before || before.deletedAt) {
      throw new NotFoundException('Company not found');
    }

    if (
      (dto.nameEn !== undefined && !dto.nameEn.trim()) ||
      (dto.nameAr !== undefined && !dto.nameAr.trim())
    ) {
      throw new BadRequestException('Company names cannot be blank');
    }

    const code = dto.code?.trim();
    if (code !== undefined && code !== before.code) {
      const clash = await this.prisma.company.findFirst({
        where: { code, id: { not: companyId } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `Another company already uses the code "${code}"`,
        );
      }
    }

    const optional = (value: string | null | undefined) =>
      value === undefined ? undefined : value?.trim() || null;

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(code !== undefined ? { code } : {}),
        nameEn: dto.nameEn?.trim(),
        nameAr: dto.nameAr?.trim(),
        taxId: optional(dto.taxId),
        commercialRegistration: optional(dto.commercialRegistration),
        // `address` is the single-line field of the desktop screens; it fills
        // the English address unless the caller sends addressEn explicitly.
        addressEn: optional(
          dto.addressEn !== undefined ? dto.addressEn : dto.address,
        ),
        addressAr: optional(dto.addressAr),
        phone: optional(dto.phone),
        email: optional(dto.email),
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'companies',
      entityId: companyId,
      before: this.auditProfile(before),
      after: this.auditProfile(updated),
    });

    return this.getProfile(companyId);
  }

  /// ──────────────────────────────────────────────────────────────── logo

  async setLogo(
    companyId: string,
    userId: string,
    data: Buffer,
    mime: string,
  ): Promise<Record<string, unknown>> {
    const checked = await normalizeLogo(data, mime);
    const before = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, logoPath: true, deletedAt: true },
    });
    if (!before || before.deletedAt) {
      throw new NotFoundException('Company not found');
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        logoData: checked.data,
        logoMime: checked.mime,
        // The database copy replaces any legacy file.
        logoPath: null,
        updatedBy: userId,
      },
    });
    await this.removeLegacyFile(before.logoPath);

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'companies',
      entityId: companyId,
      // The bytes themselves are not audited — only that the logo changed.
      after: { logo: checked.mime, size: checked.data.length },
    });

    const profile = await this.getProfile(companyId);
    return { ...profile, hasLogo: true, logoMime: checked.mime };
  }

  /// Returns the logo bytes for a company: the database copy, or the legacy
  /// file of an installation that was set up before logos moved into the
  /// database. `companyId` omitted means the default (first active) company.
  async getLogo(
    companyId?: string,
  ): Promise<{ data: Buffer; mime: string } | null> {
    const company = companyId
      ? await this.prisma.company.findUnique({ where: { id: companyId } })
      : await this.defaultCompany();
    if (!company || company.deletedAt) return null;

    if (company.logoData && company.logoData.length > 0) {
      return {
        data: Buffer.from(company.logoData),
        mime: company.logoMime ?? 'image/png',
      };
    }
    if (company.logoPath) {
      const name = basename(company.logoPath);
      try {
        const data = await readFile(join(uploadsDir(), name));
        return {
          data,
          mime: LEGACY_LOGO_MIME[extname(name).toLowerCase()] ?? 'image/png',
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  async deleteLogo(companyId: string, userId: string): Promise<void> {
    const before = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, logoPath: true },
    });
    if (!before) throw new NotFoundException('Company not found');

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        logoData: null,
        logoMime: null,
        logoPath: null,
        updatedBy: userId,
      },
    });
    await this.removeLegacyFile(before.logoPath);

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

      // A branch and its default warehouse are one operational unit. Create
      // both in the same transaction so new branches can receive and issue
      // stock immediately, even though the warehouse backfill migration has
      // already run.
      const baseWarehouseCode = `${branch.code}-MAIN`;
      const codeClash = await tx.warehouse.findFirst({
        where: { companyId, code: baseWarehouseCode },
        select: { id: true },
      });
      const warehouseCode = codeClash
        ? `${baseWarehouseCode}-${branch.id.slice(0, 8).toUpperCase()}`
        : baseWarehouseCode;

      await tx.warehouse.create({
        data: {
          companyId,
          branchId: branch.id,
          code: warehouseCode,
          nameEn: `${branch.nameEn} main store`,
          nameAr: `${branch.nameAr} - المخزن الرئيسي`,
          isDefault: true,
          isActive: true,
          createdBy: userId,
          updatedBy: userId,
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

  private async defaultCompany() {
    return this.prisma.company.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private logoUrl(company: {
    id: string;
    logoData?: Uint8Array | null;
    logoPath?: string | null;
    updatedAt: Date;
  }): string | null {
    const hasLogo =
      (company.logoData?.length ?? 0) > 0 || Boolean(company.logoPath);
    if (!hasLogo) return null;
    return `/companies/logo/${company.id}?v=${company.updatedAt.getTime()}`;
  }

  private toProfile(company: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    taxId: string | null;
    commercialRegistration: string | null;
    addressEn: string | null;
    addressAr: string | null;
    phone: string | null;
    email: string | null;
    currency: string;
    timezone: string;
    isActive: boolean;
    logoData: Uint8Array | null;
    logoMime: string | null;
    logoPath: string | null;
    updatedAt: Date;
  }) {
    const hasLogo =
      (company.logoData?.length ?? 0) > 0 || Boolean(company.logoPath);
    return {
      id: company.id,
      code: company.code,
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      taxId: company.taxId,
      commercialRegistration: company.commercialRegistration,
      addressEn: company.addressEn,
      addressAr: company.addressAr,
      // Single-line address for the desktop screens that predate the
      // bilingual address fields.
      address: company.addressEn ?? company.addressAr ?? null,
      phone: company.phone,
      email: company.email,
      currency: company.currency,
      timezone: company.timezone,
      isActive: company.isActive,
      hasLogo,
      logoMime: company.logoData ? company.logoMime : null,
      logoUrl: this.logoUrl(company),
    };
  }

  private auditProfile(company: object) {
    const {
      logoData: _logoData,
      logoMime: _logoMime,
      logoPath: _logoPath,
      ...safe
    } = company as Record<string, unknown>;
    return safe;
  }

  private async removeLegacyFile(oldPath: string | null) {
    if (!oldPath) return;
    await unlink(join(uploadsDir(), basename(oldPath))).catch(() => {});
  }

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
  maxBytes = LOGO_MAX_BYTES,
): { data: Uint8Array<ArrayBuffer>; mime: string } {
  const normalised = (mime ?? '').split(';')[0].trim().toLowerCase();
  const spec = LOGO_TYPES[normalised];
  if (!spec) {
    throw new BadRequestException(
      'يجب أن يكون الشعار صورة PNG أو JPEG أو WebP / The logo must be PNG, JPEG or WebP.',
    );
  }
  if (data.length === 0) {
    throw new BadRequestException('ملف الشعار فارغ / The logo file is empty.');
  }
  if (data.length > maxBytes) {
    throw new BadRequestException(
      `حجم الشعار يتجاوز ${Math.round(maxBytes / 1024 / 1024)} ميجابايت / The logo exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    );
  }
  const matches = spec.magic.some((signature) =>
    signature.every((byte, index) => data[index] === byte),
  );
  if (!matches) {
    throw new BadRequestException(
      'محتوى الملف لا يطابق نوع الصورة. اختر ملف PNG أو JPEG أو WebP حقيقيًا / The file content does not match its image type.',
    );
  }
  if (normalised === 'image/webp') {
    // RIFF container: bytes 8-11 must read WEBP.
    const tag = data.subarray(8, 12).toString('latin1');
    if (tag !== 'WEBP') {
      throw new BadRequestException('ملف WebP غير صالح / The file is not a valid WebP image.');
    }
  }
  // Prisma's Bytes column wants a Uint8Array; same bytes, right type.
  return { data: Uint8Array.from(data), mime: normalised };
}


/// Reads the pixel size of a PNG, JPEG or WebP without decoding it.
export function logoDimensions(
  data: Buffer,
  mime: string,
): { width: number; height: number } | null {
  if (mime === 'image/png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (mime === 'image/webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && data.length >= 26) return { width: 1 + (((data[22] ?? 0) | ((data[23] ?? 0) & 0x3f) << 8)), height: 1 + ((((data[23] ?? 0) >> 6) | (data[24] ?? 0) << 2 | ((data[25] ?? 0) & 0x0f) << 10)) };
  }
  if (mime === 'image/jpeg' && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1] ?? 0;
      const length = data.readUInt16BE(offset + 2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

/// Validates, resizes and recompresses a source image before it is persisted.
/// The upload cap and pixel cap are applied before decoding to bound memory use;
/// stored logos are always small WebP files regardless of the source format.
export async function normalizeLogo(
  data: Buffer,
  mime: string,
): Promise<{ data: Uint8Array<ArrayBuffer>; mime: string }> {
  const source = validateLogo(data, mime, LOGO_UPLOAD_MAX_BYTES);
  const input = Buffer.from(source.data);
  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: LOGO_MAX_PIXELS,
    }).metadata();
  } catch {
    throw new BadRequestException(
      'تعذّر فتح الصورة. اختر ملف PNG أو JPEG أو WebP سليمًا / The image could not be decoded.',
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    width < 32 || height < 32 || width * height > LOGO_MAX_PIXELS ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new BadRequestException(
      'يجب أن تكون أبعاد الشعار ٣٢ × ٣٢ بكسل على الأقل، وألا تتجاوز الصورة المتحركة ١٦ مليون بكسل / Use a non-animated image of at least 32 × 32 pixels and no more than 16 megapixels.',
    );
  }

  for (const [bound, quality] of [
    [LOGO_MAX_DIMENSION, 82],
    [768, 76],
    [512, 68],
    [384, 58],
    [256, 48],
  ]) {
    try {
      const encoded = await sharp(input, {
        failOn: 'error',
        limitInputPixels: LOGO_MAX_PIXELS,
      })
        .rotate()
        .resize(bound, bound, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 5 })
        .toBuffer();
      if (encoded.length <= LOGO_MAX_BYTES) {
        return { data: Uint8Array.from(encoded), mime: 'image/webp' };
      }
    } catch {
      throw new BadRequestException(
        'تعذّر ضغط الشعار. اختر صورة صالحة وحاول مرة أخرى / The logo could not be resized.',
      );
    }
  }

  throw new BadRequestException(
    'تعذّر ضغط الشعار إلى الحجم المسموح. اختر صورة أصغر / The logo remains too large after compression; choose a smaller image.',
  );
}
