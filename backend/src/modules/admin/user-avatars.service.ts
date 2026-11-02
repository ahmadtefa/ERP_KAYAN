import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  LOGO_MAX_BYTES,
  logoDimensions,
  logoMimeForUpload,
  validateLogo,
} from '../company/company.service';

/// A person's photo, and the rules that keep it theirs.
///
/// Three decisions are worth stating because they are the ones that get a
/// product into trouble:
///
///  * **Who may change it.** A person may change their own photo; anybody
///    else's needs `admin.users.manage`. The check is here, in the service,
///    not only on the button: a hand-written request must get the same answer
///    as a hidden control. A manager may also remove somebody's photo, which is
///    the same right as editing their account.
///  * **What may be stored.** The bytes are checked against their own magic
///    number (PNG/JPEG/WebP), measured for real pixel size, bounded in bytes
///    and pixels, and the declared MIME from the browser is only used to pick
///    a candidate - never trusted. An `.png` that is really SVG or a script is
///    refused, and nothing is ever executed: the file is only ever sent back
///    as `image/*` with `nosniff`.
///  * **Where it lives.** In the row (`avatarData`), so backups and restores
///    carry it and the person looks the same on any machine of this
///    installation. See the migration's comment for the full reasoning.
export interface AvatarFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

/// 512 KB is generous for a face at 512 px and keeps a 500-person company's
/// worth of photos comfortably inside one backup.
export const AVATAR_MAX_BYTES = 512 * 1024;
/// A face has no detail above this; anything larger is a photograph being
/// used as a file, not as an avatar.
const AVATAR_MAX_DIMENSION = 2048;
const AVATAR_MAX_PIXELS = 4_000_000;

@Injectable()
export class UserAvatarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /// Stores (or replaces) one account's photo.
  async setAvatar(
    companyId: string,
    actor: { userId: string; permissions: string[]; isSuperAdmin: boolean },
    targetUserId: string,
    file: AvatarFile | undefined,
  ): Promise<{ hasAvatar: true; mime: string; updatedAt: string }> {
    await this.assertMayEdit(companyId, actor, targetUserId);

    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'لم يتم اختيار صورة. / No image was chosen.',
      );
    }

    // The browser's opinion of the type, narrowed by the extension only when
    // it has none; `validateLogo` then proves the bytes are what it says.
    const candidate = logoMimeForUpload(
      file.mimetype ?? '',
      file.originalname ?? '',
    );
    let validated: { data: Uint8Array<ArrayBuffer>; mime: string };
    try {
      validated = validateLogo(file.buffer, candidate, AVATAR_MAX_BYTES);
    } catch (error) {
      // Re-word the company-logo message so the person editing their profile
      // is told about a profile photo, not a company letterhead.
      const message = error instanceof Error ? error.message : '';
      if (message.includes('/')) {
        throw new BadRequestException(
          message
            .replace('الشعار', 'الصورة الشخصية')
            .replace('The logo', 'The profile photo'),
        );
      }
      throw error;
    }

    const dimensions = logoDimensions(file.buffer, validated.mime);
    if (!dimensions) {
      throw new BadRequestException(
        'تعذر قراءة أبعاد الصورة. / The image dimensions could not be read.',
      );
    }
    if (
      dimensions.width > AVATAR_MAX_DIMENSION ||
      dimensions.height > AVATAR_MAX_DIMENSION ||
      dimensions.width * dimensions.height > AVATAR_MAX_PIXELS
    ) {
      throw new BadRequestException(
        `أبعاد الصورة ${dimensions.width}×${dimensions.height} أكبر من الحد ` +
          `(${AVATAR_MAX_DIMENSION} px لكل ضلع، ${AVATAR_MAX_DIMENSION / 1024}k بكسل). ` +
          `اختر صورة أصغر. / The photo is too large; use one up to ` +
          `${AVATAR_MAX_DIMENSION} px and ${AVATAR_MAX_PIXELS / 1_000_000} megapixels.`,
      );
    }

    const updatedAt = new Date();
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        avatarData: validated.data,
        avatarMime: validated.mime,
        avatarUpdatedAt: updatedAt,
      },
    });

    await this.audit.record({
      companyId,
      userId: actor.userId,
      action: 'UPDATE',
      entity: 'UserAvatar',
      entityId: targetUserId,
      // The image itself never goes into the audit trail: a history table is
      // not a photo album, and a purge must not have to carry megabytes.
      after: { mime: validated.mime, bytes: validated.data.length },
    });

    return {
      hasAvatar: true,
      mime: validated.mime,
      updatedAt: updatedAt.toISOString(),
    };
  }

  /// Removes the photo. The account keeps working and the client falls back to
  /// the initial letter, so "no photo" is a normal state, not an error.
  async clearAvatar(
    companyId: string,
    actor: { userId: string; permissions: string[]; isSuperAdmin: boolean },
    targetUserId: string,
  ): Promise<{ hasAvatar: false }> {
    await this.assertMayEdit(companyId, actor, targetUserId);

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { avatarData: null, avatarMime: null, avatarUpdatedAt: null },
    });

    await this.audit.record({
      companyId,
      userId: actor.userId,
      action: 'UPDATE',
      entity: 'UserAvatar',
      entityId: targetUserId,
      after: { removed: true },
    });
    return { hasAvatar: false };
  }

  /// The bytes, for any signed-in colleague of the same company.
  ///
  /// Reading a face is not reading an account: this endpoint returns the image
  /// and nothing else - no username, no permissions, no e-mail - so it is safe
  /// to allow it to every authenticated person, which is what makes an avatar
  /// visible in a list of colleagues.
  async getAvatar(
    companyId: string,
    targetUserId: string,
  ): Promise<{ data: Buffer; mime: string; updatedAt: Date | null }> {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, companyId, deletedAt: null },
      select: { avatarData: true, avatarMime: true, avatarUpdatedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.avatarData || user.avatarData.length === 0) {
      throw new NotFoundException('This user has no photo');
    }
    return {
      data: Buffer.from(user.avatarData),
      mime: user.avatarMime ?? 'image/png',
      updatedAt: user.avatarUpdatedAt ?? null,
    };
  }

  /// Own photo, or `admin.users.manage` for somebody else's.
  ///
  /// Deliberately not a role check: an administrator who must edit a colleague
  /// needs the same grant their screen already requires, and nobody gains a new
  /// capability from this feature.
  private async assertMayEdit(
    companyId: string,
    actor: { userId: string; permissions: string[]; isSuperAdmin: boolean },
    targetUserId: string,
  ): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    if (targetUserId === actor.userId) return;
    if (actor.isSuperAdmin) return;
    if (actor.permissions.includes('admin.users.manage')) return;

    throw new ForbiddenException(
      'لا يمكنك تغيير صورة حساب مستخدم آخر بدون صلاحية إدارة المستخدمين. ' +
        'يمكنك تغيير صورتك من ملفك الشخصي. ' +
        '/ You cannot change another user’s photo without the "admin.users.manage" ' +
        'permission. You can change your own from your profile.',
    );
  }
}

/// The photo limits, exported so the client's own validation and the tests use
/// the same numbers as the server rather than a hopeful copy.
export const AVATAR_LIMITS = {
  maxBytes: AVATAR_MAX_BYTES,
  maxDimension: AVATAR_MAX_DIMENSION,
  maxPixels: AVATAR_MAX_PIXELS,
  /// What the company-logo validator calls its default; kept in the export so
  /// a reader can see the avatar is the tighter of the two.
  companyLogoMaxBytes: LOGO_MAX_BYTES,
} as const;
