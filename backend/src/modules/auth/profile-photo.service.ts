import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalizeLogo } from '../company/company.service';

/** Self-service only. Neither the controller nor the body accepts a user ID. */
@Injectable()
export class ProfilePhotoService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(companyId: string, userId: string) {
    const photo = await this.prisma.userProfilePhoto.findFirst({
      where: { companyId, userId, user: { companyId, isActive: true, deletedAt: null } },
      select: { data:true, mime:true },
    });
    return photo ? { mime:photo.mime, data:Buffer.from(photo.data).toString('base64') } : { mime:null, data:null };
  }

  async set(companyId: string, userId: string, data: Buffer, mime: string) {
    return this.write(companyId, userId, userId, data, mime);
  }

  /** Used by the user-management screen.  The controller supplies the target
   * from the path and authorizes the operator; it is never client supplied. */
  async setForUser(companyId: string, actorId: string, userId: string, data: Buffer, mime: string) {
    return this.write(companyId, userId, actorId, data, mime);
  }

  private async write(companyId: string, userId: string, actorId: string, data: Buffer, mime: string) {
    // Validate and re-encode untrusted input, with pixel, size and animation caps.
    const photo = await normalizeLogo(data,mime);
    await this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM users WHERE id=${userId}::uuid AND "companyId"=${companyId}::uuid
          AND "isActive"=true AND "deletedAt" IS NULL FOR UPDATE`;
      if (!users.length) throw new NotFoundException('User not found');
      const existing = await tx.userProfilePhoto.findUnique({where:{userId},select:{companyId:true}});
      if (existing && existing.companyId !== companyId) throw new NotFoundException('User photo not found');
      await tx.userProfilePhoto.upsert({where:{userId},
        create:{userId,companyId,data:photo.data,mime:photo.mime},
        update:{data:photo.data,mime:photo.mime}});
      // Never write image bytes, filenames or content to the audit trail.
      await this.audit.recordRequired({companyId,userId:actorId,action:'PROFILE_PHOTO_SET',entity:'users',entityId:userId,
        after:{mime:photo.mime,size:photo.data.length}},tx);
    });
    return {updated:true};
  }

  async remove(companyId: string, userId: string) {
    return this.delete(companyId, userId, userId);
  }

  async removeForUser(companyId: string, actorId: string, userId: string) {
    return this.delete(companyId, userId, actorId);
  }

  private async delete(companyId: string, userId: string, actorId: string) {
    await this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM users WHERE id=${userId}::uuid AND "companyId"=${companyId}::uuid
          AND "isActive"=true AND "deletedAt" IS NULL FOR UPDATE`;
      if (!users.length) throw new NotFoundException('User not found');
      const result = await tx.userProfilePhoto.deleteMany({where:{companyId,userId}});
      if (result.count) await this.audit.recordRequired({companyId,userId:actorId,action:'PROFILE_PHOTO_REMOVE',entity:'users',entityId:userId},tx);
    });
    return {deleted:true};
  }
}
