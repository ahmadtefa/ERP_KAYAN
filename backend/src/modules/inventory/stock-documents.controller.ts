import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { assertTransferAccess, assertWarehouseAccess, grantsOf, WarehouseAction } from '../../common/warehouse/warehouse-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { StockDocumentsService } from './stock-documents.service';

/// Adjustments, transfers, counts and write-offs. Separate permissions for
/// reading, creating, approving and posting, because writing stock off is not
/// the same job as recording that it was counted.
///
/// Two approval cycles live here side by side and never mix:
///  - stock vouchers: PUT :id/voucher-draft, POST :id/review, POST :id/approve
///    (inventory.stock.review / inventory.stock.approve);
///  - write-off documents: POST :id/write-off/approve (inventory.writeoff.approve).
/// Posting enforces the approval rule for both families on every route.
@Controller('inventory/stock-documents')
export class StockDocumentsController {
  constructor(private readonly service: StockDocumentsService) {}

  @Get()
  @RequirePermissions('inventory.stock.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.service.findAll(user.companyId, {
      kind: query.kind,
      q: query.q,
      voucherOnly: query.voucherOnly === 'true',
      branchId: query.branchId,
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    }, user.branchId ?? null, grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId));
  }

  @Get(':id')
  @RequirePermissions('inventory.stock.read')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assertDocumentAccess(user, id, 'view');
    return this.service.findOne(user.companyId, id, canReadCost(user), user.branchId ?? null);
  }

  @Post()
  @RequirePermissions('inventory.stock.adjust')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
    // A retry after a dropped connection carries the same key and gets the
    // same document back, instead of booking a second loss.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const kind = String(body.kind ?? '').toUpperCase();
    if (kind === 'WRITE_OFF') {
      assertWarehouseAccess(user, body.toWarehouseId as string, 'approve');
    }
    // A transfer leaves one shelf and arrives at another, so it is checked on
    // both ends: being trusted with only the source is not a transfer.
    if (kind === 'TRANSFER') {
      assertTransferAccess(
        user,
        body.fromWarehouseId as string,
        body.toWarehouseId as string,
      );
    }
    // The header key is folded into the body so the service sees one request
    // object; a retry after a dropped connection returns the same document.
    if (idempotencyKey?.trim() && body.idempotencyKey === undefined) {
      body.idempotencyKey = idempotencyKey.trim();
    }
    return this.service.create(user.companyId, user.branchId, user.userId, body as never, canReadCost(user));
  }

  @Put(':id/voucher-draft')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.adjust')
  updateVoucher(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateVoucher(user.companyId, user.branchId, user.userId, id, body as never, canReadCost(user));
  }

  @Post(':id/review')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.review')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.transitionVoucher(user.companyId, user.branchId, user.userId, id, 'REVIEW', canReadCost(user), this.voucherVersion(body));
  }

  /// Stock-voucher approval (workflow of PR70). Write-off documents use
  /// :id/write-off/approve instead.
  @Post(':id/approve')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.transitionVoucher(user.companyId, user.branchId, user.userId, id, 'APPROVE', canReadCost(user), this.voucherVersion(body));
  }

  /// The warehouse a document touches, so approving or posting it is checked
  /// against the same grant that creating it was. Recording a loss and
  /// accepting it are two people's jobs, but both of them have to be trusted
  /// with the shelf it happens on - otherwise the access screen would only
  /// decide who may *start* the paperwork.
  private async assertDocumentAccess(
    user: AuthUser,
    id: string,
    action: WarehouseAction,
  ) {
    const document = (await this.service.findOne(
      user.companyId,
      id,
      canReadCost(user),
      user.branchId ?? null,
    )) as unknown as {
      kind?: string;
      voucherKind?: string | null;
      fromWarehouseId?: string | null;
      toWarehouseId?: string | null;
    };
    const kind = String(document?.kind ?? '').toUpperCase();
    if (kind === 'TRANSFER') {
      assertTransferAccess(user, document.fromWarehouseId ?? '', document.toWarehouseId ?? '');
      return document;
    }
    const warehouseId = document?.toWarehouseId ?? document?.fromWarehouseId ?? '';
    assertWarehouseAccess(user, warehouseId, action);
    return document;
  }

  /// Approves a write-off. Its own permission: recording a loss and accepting
  /// it are two different people's jobs. Distinct route from the voucher
  /// approval so the two cycles cannot be confused or bypassed.
  @Post(':id/write-off/approve')
  @RequirePermissions('inventory.writeoff.approve')
  async approveWriteOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assertDocumentAccess(user, id, 'approve');
    return this.service.approve(user.companyId, user.userId, id);
  }

  @Post(':id/post')
  @RequirePermissions('inventory.stock.adjust')
  async post(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    await this.assertDocumentAccess(user, id, 'post');
    return this.service.post(user.companyId, user.userId, id, canReadCost(user), user.branchId, body?.expectedVersion, true);
  }

  /// Write-off posting has its own permission, but the same approval rule is
  /// enforced inside the service on both routes.
  @Post(':id/write-off/post')
  @RequirePermissions('inventory.writeoff.post')
  async postWriteOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assertDocumentAccess(user, id, 'post');
    return this.service.post(user.companyId, user.userId, id, canReadCost(user), user.branchId);
  }

  private voucherVersion(body: Record<string, unknown> | undefined): number {
    const version = body?.expectedVersion;
    if (!Number.isSafeInteger(version) || (version as number) < 0) throw new BadRequestException('expectedVersion is required');
    return version as number;
  }

  @Post(':id/reverse')
  @RequirePermissions('inventory.stock.adjust')
  async reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assertDocumentAccess(user, id, 'post');
    return this.service.reverse(user.companyId, user.userId, id, canReadCost(user), user.branchId);
  }
}
