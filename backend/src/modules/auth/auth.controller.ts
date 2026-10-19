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
      },
    };
  }
}
