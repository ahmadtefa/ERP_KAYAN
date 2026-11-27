import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuditService } from '../../common/audit/audit.service';
import { canReadPurchasePrice, canReadSalePrice } from '../../common/auth/cost-visibility';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { MasterDataBackupService, MasterDataKind, MASTER_DATA_KINDS } from './master-data-backup.service';

const READ_PERMISSION: Record<MasterDataKind, string> = {
  items: 'inventory.items.read',
  customers: 'parties.customers.read',
  suppliers: 'parties.suppliers.read',
};
const CREATE_PERMISSION: Record<MasterDataKind, string> = {
  items: 'inventory.items.create',
  customers: 'parties.customers.create',
  suppliers: 'parties.suppliers.create',
};
const UPDATE_PERMISSION: Record<MasterDataKind, string> = {
  items: 'inventory.items.update',
  customers: 'parties.customers.update',
  suppliers: 'parties.suppliers.update',
};

@Controller('master-data-backups')
export class MasterDataBackupController {
  constructor(
    private readonly service: MasterDataBackupService,
    private readonly audit: AuditService,
  ) {}

  @Get(':kind/download')
  @AllowQueryToken()
  async download(
    @CurrentUser() user: AuthUser,
    @Param('kind') value: string,
    @Res() response: Response,
  ): Promise<void> {
    const kind = this.kind(value);
    this.require(user, READ_PERMISSION[kind]);
    const archive = await this.service.create(kind, user.companyId, {
      salePrice: canReadSalePrice(user),
      purchasePrice: canReadPurchasePrice(user),
      manageSalePrice: user.isSuperAdmin || user.permissions.includes('inventory.items.saleprice.manage'),
      managePurchasePrice: user.isSuperAdmin || user.permissions.includes('inventory.items.purchaseprice.manage'),
    });
    const body = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`, 'utf8');
    const stamp = new Date().toISOString().slice(0, 10);
    await this.audit.record({
      companyId: user.companyId,
      userId: user.userId,
      action: 'MASTER_DATA_BACKUP',
      entity: kind,
      after: { format: archive.format, version: archive.version, recordCount: archive.recordCount },
    });
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="kayan-${kind}-${stamp}.json"`);
    response.setHeader('Content-Length', String(body.length));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(body);
  }

  @Post(':kind/preview')
  async preview(
    @CurrentUser() user: AuthUser,
    @Param('kind') value: string,
    @Body() body: { backup?: unknown },
  ) {
    const kind = this.kind(value);
    this.requireRestore(user, kind);
    return this.service.preview(kind, user.companyId, body?.backup, {
      salePrice: canReadSalePrice(user),
      purchasePrice: canReadPurchasePrice(user),
      manageSalePrice: user.isSuperAdmin || user.permissions.includes('inventory.items.saleprice.manage'),
      managePurchasePrice: user.isSuperAdmin || user.permissions.includes('inventory.items.purchaseprice.manage'),
    });
  }

  @Post(':kind/restore')
  async restore(
    @CurrentUser() user: AuthUser,
    @Param('kind') value: string,
    @Body() body: { backup?: unknown; previewFingerprint?: unknown },
  ) {
    const kind = this.kind(value);
    this.requireRestore(user, kind);
    return this.service.restore(
      kind,
      user.companyId,
      user.userId,
      body?.backup,
      body?.previewFingerprint,
      {
        salePrice: canReadSalePrice(user),
        purchasePrice: canReadPurchasePrice(user),
        manageSalePrice: user.isSuperAdmin || user.permissions.includes('inventory.items.saleprice.manage'),
        managePurchasePrice: user.isSuperAdmin || user.permissions.includes('inventory.items.purchaseprice.manage'),
      },
    );
  }

  private kind(value: string): MasterDataKind {
    if (!MASTER_DATA_KINDS.includes(value as MasterDataKind)) {
      throw new BadRequestException({ code: 'MASTER_BACKUP_TYPE_UNKNOWN', message: `Unknown master-data backup type: ${value}.` });
    }
    return value as MasterDataKind;
  }

  private require(user: AuthUser, permission: string): void {
    if (!user.isSuperAdmin && !user.permissions.includes(permission)) {
      throw new ForbiddenException({ code: 'PERMISSION_MISSING', message: `Missing permission: ${permission}.` });
    }
  }

  private requireRestore(user: AuthUser, kind: MasterDataKind): void {
    if (user.isSuperAdmin) return;
    const needed = [CREATE_PERMISSION[kind], UPDATE_PERMISSION[kind]];
    if (!needed.every((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException({ code: 'MASTER_BACKUP_RESTORE_PERMISSION', message: `Restoring ${kind} requires both ${needed[0]} and ${needed[1]}.` });
    }
  }
}
