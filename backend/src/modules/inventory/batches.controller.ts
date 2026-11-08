import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import {
  assertTransferAccess,
  assertWarehouseAccess,
  grantsOf,
} from '../../common/warehouse/warehouse-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import {
  BatchesService,
  IssueInput,
  ReceiveLotInput,
  TransferInput,
  WriteOffInput,
} from './batches.service';

class ReceiveLotDto implements ReceiveLotInput {
  @IsString() branchId!: string;
  @IsString() warehouseId!: string;
  @IsString() itemId!: string;
  @IsOptional() @IsString() batchNumber?: string | null;
  @IsOptional() @IsString() productionDate?: string | null;
  @IsOptional() @IsString() expiryDate?: string | null;
  @IsNumber() quantity!: number;
  @IsNumber() @Min(0) unitCost!: number;
  @IsOptional() @IsString() storageLocationId?: string | null;
  @IsOptional() @IsString() sourceType?: string | null;
  @IsOptional() @IsString() sourceId?: string | null;
  @IsOptional() @IsString() sourceNumber?: string | null;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() documentDate?: string | null;
}

class IssueDto implements IssueInput {
  @IsString() branchId!: string;
  @IsString() warehouseId!: string;
  @IsString() itemId!: string;
  @IsNumber() quantity!: number;
  @IsOptional() @IsString() batchId?: string | null;
  /// Never trusted on its own. The controller recomputes the real approval
  /// from the caller's permissions and overwrites whatever arrived here; a
  /// body that sets it to true without the permission changes nothing.
  @IsOptional() @IsBoolean() allowExpired?: boolean;
  @IsOptional() @IsString() reason?: string | null;
  @IsOptional() @IsString() storageLocationId?: string | null;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() referenceId?: string | null;
  @IsOptional() @IsString() referenceNumber?: string | null;
  @IsOptional() @IsString() documentDate?: string | null;
}

class WriteOffDto implements WriteOffInput {
  @IsString() branchId!: string;
  @IsString() warehouseId!: string;
  @IsString() itemId!: string;
  @IsString() batchId!: string;
  @IsNumber() quantity!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() documentDate?: string | null;
}

class TransferDto implements TransferInput {
  @IsString() branchId!: string;
  @IsString() fromWarehouseId!: string;
  @IsString() toWarehouseId!: string;
  @IsString() itemId!: string;
  @IsString() batchId!: string;
  @IsNumber() quantity!: number;
  @IsOptional() @IsString() reason?: string | null;
  @IsOptional() @IsString() documentDate?: string | null;
}

/**
 * Lots: the goods themselves, not the totals.
 *
 * A lot is what makes "which one expires first?" and "where did this batch
 * come from?" answerable. Receiving and issuing are stock movements, so they
 * are guarded by the same permissions that guard the stock card; writing off
 * has its own permission because destroying goods is a decision, not a
 * clerical act; moving a lot between warehouses is a transfer.
 */
@Controller('inventory/batches')
export class BatchesController {
  constructor(private readonly service: BatchesService) {}

  @Get()
  @RequirePermissions('inventory.batches.read')
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    query: {
      itemId?: string;
      warehouseId?: string;
      status?: string;
      expiringInDays?: string;
      includeEmpty?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    return this.service.list(
      user.companyId,
      {
        itemId: query.itemId,
        warehouseId: query.warehouseId,
        status: query.status,
        expiringInDays:
          query.expiringInDays === undefined ? undefined : Number(query.expiringInDays),
        includeEmpty: query.includeEmpty === 'true',
        page: query.page ? Number(query.page) : undefined,
        pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      },
      warehouseScopeOf(user),
      // A person with warehouse grants sees the lots of their own shelves and
      // no others - in the list, the expiry report and the trace alike.
      grantsOf(user),
    );
  }

  @Get('expiry-report')
  @RequirePermissions('inventory.batches.read')
  expiryReport(
    @CurrentUser() user: AuthUser,
    @Query()
    query: {
      band?: string;
      warehouseId?: string;
      itemId?: string;
      categoryId?: string;
      asOf?: string;
      days?: string;
    },
  ) {
    const grants = grantsOf(user);
    const visibleGrants = grants?.filter((grant) =>
      query.warehouseId
        ? grant.warehouseId === query.warehouseId && grant.canView
        : grant.canView,
    );
    const mayReadCosts =
      canReadCost(user) && (grants === null || (visibleGrants ?? []).every((grant) => grant.canSeeCost));
    return this.service.expiryReport(
      user.companyId,
      query,
      warehouseScopeOf(user),
      grants?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    ).then((report) => {
      if (mayReadCosts) return report;
      const hideCosts = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(hideCosts);
        if (value === null || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== 'unitCost' && key !== 'value' && key !== 'atRisk')
            .map(([key, child]) => [key, hideCosts(child)]),
        );
      };
      return hideCosts(report);
    });
  }

  @Get(':id/trace')
  @RequirePermissions('inventory.batches.read')
  trace(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.trace(
      user.companyId,
      id,
      warehouseScopeOf(user),
      grantsOf(user),
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.batches.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(
      user.companyId,
      id,
      warehouseScopeOf(user),
      grantsOf(user),
    );
  }

  @Post('receive')
  @RequirePermissions('inventory.batches.receive')
  receive(@CurrentUser() user: AuthUser, @Body() dto: ReceiveLotDto) {
    assertWarehouseAccess(user, dto.warehouseId, 'receive');
    return this.service.receive(user.companyId, user.userId, dto, warehouseScopeOf(user));
  }

  @Post('issue')
  @RequirePermissions('inventory.batches.issue')
  issue(@CurrentUser() user: AuthUser, @Body() dto: IssueDto) {
    assertWarehouseAccess(user, dto.warehouseId, 'issue');
    // The approval is built here, from the permission on the authenticated
    // user - never from the request body. A caller without
    // `inventory.batches.expired.issue` cannot obtain it by sending
    // `allowExpired: true`; the flag is overwritten with what the token says.
    const mayIssueExpired =
      user.isSuperAdmin ||
      (user.permissions ?? []).includes('inventory.batches.expired.issue');
    const reason = (dto.reason ?? '').trim();
    return this.service.issue(
      user.companyId,
      user.userId,
      {
        ...dto,
        ...(mayIssueExpired
          ? {
              allowExpired: true,
              expiredApproval: {
                userId: user.userId,
                reason:
                  reason.length >= 3
                    ? reason
                    : 'Approved issue of expired stock (no reason supplied on the request)',
              },
            }
          : { allowExpired: false, expiredApproval: undefined }),
      },
      warehouseScopeOf(user),
    );
  }

  @Post('write-off')
  @RequirePermissions('inventory.batches.writeoff')
  writeOff(@CurrentUser() user: AuthUser, @Body() dto: WriteOffDto) {
    assertWarehouseAccess(user, dto.warehouseId, 'issue');
    return this.service.writeOff(user.companyId, user.userId, dto, warehouseScopeOf(user));
  }

  @Post('transfer')
  @RequirePermissions('inventory.batches.transfer')
  transfer(@CurrentUser() user: AuthUser, @Body() dto: TransferDto) {
    assertTransferAccess(user, dto.fromWarehouseId, dto.toWarehouseId);
    return this.service.transfer(user.companyId, user.userId, dto, warehouseScopeOf(user));
  }
}
