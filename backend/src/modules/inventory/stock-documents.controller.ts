import { BadRequestException, Body, ForbiddenException, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { assertTransferAccess, assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
import type { WarehouseAction } from '../../common/warehouse/warehouse-access';
import { scopedBranchId } from '../../common/warehouse/warehouse.service';
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
      // The list is branch-confined like every other reading route: a
      // `branchId` the client types is checked against the assignment, and a
      // single-branch account does not get the whole company by omitting it.
      branchId: scopedBranchId(user, query.branchId),
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    }, user.branchId ?? null, grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId));
  }

  @Get(':id')
  @RequirePermissions('inventory.stock.read')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const document = await this.assertDocumentAccess(user, id, 'view');
    return this.service.findOne(user.companyId, id, this.mayReadDocumentCost(user, document), user.branchId ?? null);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
    // A retry after a dropped connection carries the same key and gets the
    // same document back, instead of booking a second loss.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const kind = String(body.kind ?? '').toUpperCase();
    // A write-off is recorded under its own grant (inventory.writeoff.create),
    // so a storekeeper can be allowed to write off without being allowed to
    // adjust stock in general. Every other kind keeps the stock-adjust grant.
    const needed = kind === 'WRITE_OFF' ? 'inventory.writeoff.create' : 'inventory.stock.adjust';
    if (!user.isSuperAdmin && !user.permissions.includes(needed)) {
      throw new ForbiddenException(
        `ليس لديك صلاحية تنفيذ هذا الإجراء (${needed}). اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والصلاحيات. ` +
          `/ Missing permission: ${needed}. Ask an administrator to grant it to your role.`,
      );
    }
    return this.createDocument(user, body, idempotencyKey);
  }

  /// Shared by the document route and the storekeeper voucher route, which
  /// has its own grant (inventory.stock.voucher.create) checked by the guard.
  private createDocument(user: AuthUser, body: Record<string, unknown>, idempotencyKey?: string) {
    const kind = String(body.kind ?? '').toUpperCase();
    if (kind === 'WRITE_OFF') {
      assertWarehouseAccess(user, body.toWarehouseId as string, 'issue');
    }
    const voucherKind = String(body.voucherKind ?? '').toUpperCase();
    if (voucherKind === 'RECEIPT' || voucherKind === 'ISSUE') {
      assertWarehouseAccess(
        user,
        body.toWarehouseId as string,
        voucherKind === 'RECEIPT' ? 'receive' : 'issue',
      );
      if (voucherKind === 'RECEIPT') {
        assertWarehouseAccess(user, body.toWarehouseId as string, 'cost');
      }
    }
    // A transfer leaves one shelf and arrives at another, so it is checked on
    // both ends: being trusted with only the source is not a transfer.
    if (kind === 'TRANSFER') {
      assertTransferAccess(
        user,
        body.fromWarehouseId as string,
        body.toWarehouseId as string,
      );
    } else if (kind === 'ADJUSTMENT' && !voucherKind) {
      assertWarehouseAccess(user, body.toWarehouseId as string, 'approve');
    } else if (kind === 'COUNT') {
      assertWarehouseAccess(user, body.toWarehouseId as string, 'count');
    }
    // The header key is folded into the body so the service sees one request
    // object; a retry after a dropped connection returns the same document.
    if (idempotencyKey?.trim() && body.idempotencyKey === undefined) {
      body.idempotencyKey = idempotencyKey.trim();
    }
    return this.service.create(user.companyId, user.branchId, user.userId, body as never, canReadCost(user));
  }

  /// Storekeepers may prepare voucher documents without receiving the broader
  /// stock-adjust permission that also covers manual adjustments and write-offs.
  @Post('vouchers')
  @RequirePermissions('inventory.stock.voucher.create')
  createVoucher(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const voucherKind = String(body.voucherKind ?? '').toUpperCase();
    if (voucherKind !== 'RECEIPT' && voucherKind !== 'ISSUE') {
      throw new BadRequestException('voucherKind must be RECEIPT or ISSUE');
    }
    return this.createDocument(user, { ...body, kind: 'ADJUSTMENT', voucherKind }, idempotencyKey);
  }

  @Put('vouchers/:id/draft')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.voucher.create')
  async updateVoucherDraftForStorekeeper(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const document = await this.assertDocumentAccess(user, id, 'view');
    if (!document.voucherKind) throw new BadRequestException({ code: 'VOUCHER_NOT_WAREHOUSE', message: 'This is not a warehouse voucher' });
    assertWarehouseAccess(
      user,
      document.toWarehouseId ?? '',
      document.voucherKind === 'RECEIPT' ? 'receive' : 'issue',
    );
    return this.service.updateVoucher(
      user.companyId,
      user.branchId,
      user.userId,
      id,
      body as never,
      this.mayReadDocumentCost(user, document),
    );
  }

  @Post('vouchers/:id/post')
  @RequirePermissions('inventory.stock.voucher.post')
  async postVoucherForStorekeeper(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const document = await this.assertDocumentAccess(user, id, 'post');
    if (!document.voucherKind) throw new BadRequestException({ code: 'VOUCHER_NOT_WAREHOUSE', message: 'This is not a warehouse voucher' });
    return this.service.post(
      user.companyId,
      user.userId,
      id,
      this.mayReadDocumentCost(user, document),
      user.branchId,
      body?.expectedVersion,
      true,
    );
  }

  @Post('vouchers/:id/reverse')
  @RequirePermissions('inventory.stock.voucher.post')
  async reverseVoucherForStorekeeper(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const document = await this.assertDocumentAccess(user, id, 'reverse');
    if (!document.voucherKind) throw new BadRequestException({ code: 'VOUCHER_NOT_WAREHOUSE', message: 'This is not a warehouse voucher' });
    return this.service.reverse(
      user.companyId,
      user.userId,
      id,
      this.mayReadDocumentCost(user, document),
      user.branchId,
    );
  }

  @Put(':id/voucher-draft')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.adjust')
  async updateVoucher(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const document = await this.assertDocumentAccess(user, id, 'view');
    assertWarehouseAccess(
      user,
      document.toWarehouseId ?? '',
      document.voucherKind === 'RECEIPT' ? 'receive' : 'issue',
    );
    return this.service.updateVoucher(user.companyId, user.branchId, user.userId, id, body as never, this.mayReadDocumentCost(user, document));
  }

  /// Corrects the shelves of a draft (source, and receiving shelf on a
  /// transfer). Nothing else on the document changes.
  @Put(':id/draft-locations')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.adjust')
  async updateDraftLocations(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const document = await this.assertDocumentAccess(user, id, 'view');
    return this.service.updateDraftLocations(user.companyId, user.userId, id, body as never, this.mayReadDocumentCost(user, document));
  }

  @Post(':id/review')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.review')
  async review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const document = await this.assertDocumentAccess(user, id, 'approve');
    return this.service.transitionVoucher(user.companyId, user.branchId, user.userId, id, 'REVIEW', this.mayReadDocumentCost(user, document), this.voucherVersion(body));
  }

  /// Stock-voucher approval (workflow of PR70). Write-off documents use
  /// :id/write-off/approve instead.
  @Post(':id/approve')
  @RequirePermissions('inventory.stock.read', 'inventory.stock.approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const document = await this.assertDocumentAccess(user, id, 'approve');
    return this.service.transitionVoucher(user.companyId, user.branchId, user.userId, id, 'APPROVE', this.mayReadDocumentCost(user, document), this.voucherVersion(body));
  }

  /// The warehouse a document touches, so approving or posting it is checked
  /// against the same grant that creating it was. Recording a loss and
  /// accepting it are two people's jobs, but both of them have to be trusted
  /// with the shelf it happens on - otherwise the access screen would only
  /// decide who may *start* the paperwork.
  private mayReadDocumentCost(
    user: AuthUser,
    document: { fromWarehouseId?: string | null; toWarehouseId?: string | null },
  ): boolean {
    if (!canReadCost(user)) return false;
    const grants = grantsOf(user);
    if (grants === null) return true;
    const warehouseIds = [document.fromWarehouseId, document.toWarehouseId].filter(
      (id): id is string => Boolean(id),
    );
    return warehouseIds.every((id) =>
      grants.some((grant) => grant.warehouseId === id && grant.canSeeCost),
    );
  }

  private async assertDocumentAccess(
    user: AuthUser,
    id: string,
    action: WarehouseAction | 'post' | 'reverse',
  ) {
    const document = (await this.service.findOne(
      user.companyId,
      id,
      false,
      user.branchId ?? null,
    )) as unknown as {
      kind?: string;
      voucherKind?: string | null;
      fromWarehouseId?: string | null;
      toWarehouseId?: string | null;
    };
    const kind = String(document?.kind ?? '').toUpperCase();
    if (kind === 'TRANSFER') {
      if (action === 'view') {
        assertWarehouseAccess(user, document.fromWarehouseId, 'view');
        assertWarehouseAccess(user, document.toWarehouseId, 'view');
      } else if (action === 'approve') {
        assertWarehouseAccess(user, document.fromWarehouseId, 'approve');
        assertWarehouseAccess(user, document.toWarehouseId, 'approve');
      } else if (action === 'reverse') {
        assertTransferAccess(user, document.toWarehouseId ?? '', document.fromWarehouseId ?? '');
      } else {
        assertTransferAccess(user, document.fromWarehouseId ?? '', document.toWarehouseId ?? '');
      }
      return document;
    }
    const warehouseId = document?.toWarehouseId ?? document?.fromWarehouseId ?? '';
    const requiredAction: WarehouseAction =
      action !== 'post' && action !== 'reverse'
        ? action
        : action === 'reverse'
          ? kind === 'WRITE_OFF' || document?.voucherKind === 'ISSUE'
            ? 'receive'
            : document?.voucherKind === 'RECEIPT'
              ? 'issue'
              : 'approve'
          : kind === 'WRITE_OFF' || document?.voucherKind === 'ISSUE'
            ? 'issue'
            : document?.voucherKind === 'RECEIPT'
              ? 'receive'
              : 'approve';
    assertWarehouseAccess(user, warehouseId, requiredAction);
    return document;
  }

  /// Approves a write-off. Its own permission: recording a loss and accepting
  /// it are two different people's jobs. Distinct route from the voucher
  /// approval so the two cycles cannot be confused or bypassed.
  @Post(':id/write-off/approve')
  @RequirePermissions('inventory.writeoff.approve')
  async approveWriteOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const document = await this.assertDocumentAccess(user, id, 'approve');
    return this.service.approve(user.companyId, user.userId, id, this.mayReadDocumentCost(user, document));
  }

  @Post(':id/post')
  @RequirePermissions('inventory.stock.adjust')
  async post(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const document = await this.assertDocumentAccess(user, id, 'post');
    return this.service.post(user.companyId, user.userId, id, this.mayReadDocumentCost(user, document), user.branchId, body?.expectedVersion, true);
  }

  /// Write-off posting has its own permission, but the same approval rule is
  /// enforced inside the service on both routes.
  @Post(':id/write-off/post')
  @RequirePermissions('inventory.writeoff.post')
  async postWriteOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const document = await this.assertDocumentAccess(user, id, 'post');
    return this.service.post(user.companyId, user.userId, id, this.mayReadDocumentCost(user, document), user.branchId);
  }

  private voucherVersion(body: Record<string, unknown> | undefined): number {
    const version = body?.expectedVersion;
    if (!Number.isSafeInteger(version) || (version as number) < 0) throw new BadRequestException('expectedVersion is required');
    return version as number;
  }

  @Post(':id/reverse')
  @RequirePermissions('inventory.stock.adjust')
  async reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const document = await this.assertDocumentAccess(user, id, 'reverse');
    return this.service.reverse(user.companyId, user.userId, id, this.mayReadDocumentCost(user, document), user.branchId);
  }
}
