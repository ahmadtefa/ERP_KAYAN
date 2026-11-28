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
import { ChangePasswordDto } from './dto/change-password.dto';

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
      dto.companyCode,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @Public()
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.auth.changeOwnPassword(
      dto.username,
      dto.companyCode,
      dto.currentPassword,
      dto.newPassword,
      dto.confirmPassword,
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
    @Body() body?: { refreshToken?: unknown },
    @Headers('x-refresh-token') headerToken?: string,
  ) {
    // The session to end is named by the body (what the desktop program
    // sends) or, for older clients, the header. An absent token is not an
    // error: it means "end every session of this account".
    const fromBody = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    const refreshToken = fromBody?.trim() || headerToken?.trim() || undefined;
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
      },
    });

    // The guard has already resolved active, tenant-scoped roles. Re-reading
    // assignments here used to include disabled roles and could make the UI
    // show financial sections after a manager role was revoked.
    const roles = [...new Set(user.roles ?? [])];

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
