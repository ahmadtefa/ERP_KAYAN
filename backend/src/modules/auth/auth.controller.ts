import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(
      dto.username,
      dto.password,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /**
   * Exchanges the caller's session for a one-minute ticket that a browser
   * navigation (a download tab) may carry as `?ticket=`.
   */
  @Post('download-ticket')
  issueDownloadTicket(@CurrentUser() user: AuthUser) {
    return this.auth.issueDownloadTicket(user);
  }

  @Post('logout')
  async logout(
    @CurrentUser() user: AuthUser,
    @Headers('x-refresh-token') refreshToken?: string,
  ) {
    await this.auth.logout(user.userId, refreshToken);
    return { success: true };
  }

  /** Returns the current, already-authorized principal with current role labels. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: {
        id: true,
        fullNameEn: true,
        isActive: true,
        // Present or null tells the client whether to draw a photo or the
        // initial letter; the bytes themselves are one request away.
        avatarUpdatedAt: true,
        userRoles: {
          where: {
            companyId: user.companyId,
            role: {
              deletedAt: null,
              OR: [{ companyId: user.companyId }, { companyId: null }],
            },
          },
          select: { role: { select: { code: true } } },
        },
      },
    });

    const roles = [...new Set(record.userRoles.map((ur) => ur.role.code))];

    // A photo exists only when there is a timestamp saying so.
    //
    // `!== null` was the bug: a row that does not carry the column at all -
    // a narrower `select` in a later refactor, a mock in a test, a client
    // built against an older query - yields `undefined`, and `undefined !==
    // null` is `true`. The screen then asked for an image that does not exist
    // and drew a broken face instead of the person's initial. `!= null` is
    // the deliberate loose form: one answer for absent and for null, because
    // from the client's side they are the same fact - there is no picture.
    const hasAvatar = record.avatarUpdatedAt != null;

    return {
      user: {
        id: user.userId,
        username: user.username,
        fullName: record.fullNameEn,
        companyId: user.companyId,
        branchId: user.branchId,
        roles,
        // Permissions come from JwtAuthGuard's tenant-scoped database lookup.
        permissions: user.permissions,
        isActive: record.isActive,
        isSuperAdmin: user.isSuperAdmin,
        hasAvatar,
        avatarUrl: hasAvatar ? `/users/${user.userId}/avatar` : null,
      },
    };
  }
}
