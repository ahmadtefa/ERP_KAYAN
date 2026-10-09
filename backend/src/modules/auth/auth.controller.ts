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

  @Post('logout')
  async logout(
    @CurrentUser() user: AuthUser,
    @Headers('x-refresh-token') refreshToken?: string,
  ) {
    await this.auth.logout(user.userId, refreshToken);
    return { success: true };
  }

  /** Returns the current principal, re-read from the database. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: { rolePermissions: { include: { permission: true } } },
            },
          },
        },
        branches: true,
      },
    });

    const permissions = [
      ...new Set(
        record.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ];
    const roles = [...new Set(record.userRoles.map((ur) => ur.role.code))];

    return {
      user: {
        id: record.id,
        username: record.username,
        fullName: record.fullNameEn,
        companyId: record.companyId,
        branchId: record.branches[0]?.branchId ?? null,
        roles,
        permissions,
        isActive: record.isActive,
      },
    };
  }
}
