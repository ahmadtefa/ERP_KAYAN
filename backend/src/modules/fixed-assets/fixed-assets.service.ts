import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  FixedAsset,
  FixedAssetStatus,
  InvoiceStatus,
  Prisma,
  StockDirection,
} from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { movementUnitSnapshot } from '../../common/units/unit-math';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingLine, PostingService } from '../accounting/posting.service';
import {
  bookValue,
  depreciableBase,
  disposalResult,
  monthEndOf,
  nextCharge,
  periodKeyOf,
} from './depreciation';
import {
  ActivateFixedAssetDto,
  CreateFixedAssetDto,
  DisposeFixedAssetDto,
  ListDepreciationRunsDto,
  ListFixedAssetsDto,
  RunDepreciationDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';

const MONEY_SCALE = 4;
const money = (value: Prisma.Decimal) => value.toFixed(MONEY_SCALE);
const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The fixed-asset register and everything it does to the ledger.
 *
 * Three postings, each atomic with the register change that causes it,
 * each traceable through the posting service's source fields:
 *
 *   activation   Dr asset account            Cr funding account
 *   depreciation Dr depreciation expense     Cr accumulated depreciation
 *   disposal     Dr accumulated depreciation Cr asset account (at cost)
 *                Dr proceeds account         Cr/Dr gain or loss
 *
 * Nothing here carries a stored balance that could drift: accumulated
 * depreciation is always the sum of the monthly charges, and the summary
 * report compares the register against the ledger accounts themselves.
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accountMap: AccountMapService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehouseService,
  ) {}

  /**
   * Resolves and bounds a purchase-line link inside the caller's
   * transaction. A posted purchase already debited inventory (and
   * claimed its VAT), so what may be capitalised from one line — in
   * cost and in units, across every asset linked to it — is at most
   * what the line itself received. That ceiling is what stops the
   * same purchase from becoming an asset twice.
   */
  private async resolvePurchaseLink(
    tx: Prisma.TransactionClient,
    companyId: string,
    input: {
      purchaseInvoiceId?: string | null;
      purchaseInvoiceLineId?: string | null;
      purchaseQuantity?: string | null;
      cost: Prisma.Decimal;
      excludeAssetId?: string;
    },
  ): Promise<{
    purchaseInvoiceId: string | null;
    purchaseInvoiceLineId: string | null;
    purchaseQuantity: Prisma.Decimal | null;
    supplierIdHint: string | null;
  }> {
    if (!input.purchaseInvoiceLineId) {
      return {
        purchaseInvoiceId: input.purchaseInvoiceId ?? null,
        purchaseInvoiceLineId: null,
        purchaseQuantity: null,
        supplierIdHint: null,
      };
    }
    const line = await tx.purchaseInvoiceLine.findFirst({
      where: {
        id: input.purchaseInvoiceLineId,
        invoice: { companyId, deletedAt: null },
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            supplierId: true,
            warehouseId: true,
          },
        },
      },
    });
    if (!line) {
      throw new BadRequestException('The purchase invoice line does not exist');
    }
    // Serialize capitalisations of this one line. The cumulative check
    // below reads what other assets already took; without the row lock
    // two concurrent creates could both read "nothing taken yet" and
    // together capitalise more than the line ever received.
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "purchase_invoice_lines"
       WHERE "id" = ${line.id}::uuid
       FOR UPDATE
    `);
    if (
      input.purchaseInvoiceId &&
      input.purchaseInvoiceId !== line.invoice.id
    ) {
      throw new BadRequestException(
        'The purchase line belongs to a different invoice than the one given',
      );
    }
    // What the line still holds after any posted returns against it.
    const lineCost = (
      line.inventoryCostTotal.isZero() && !line.lineTotal.isZero()
        ? line.lineTotal
        : line.inventoryCostTotal
    ).minus(line.returnedCostTotal);
    const lineQuantity = line.quantity.minus(line.returnedQuantity);
    const others = await tx.fixedAsset.aggregate({
      where: {
        companyId,
        purchaseInvoiceLineId: line.id,
        deletedAt: null,
        ...(input.excludeAssetId ? { id: { not: input.excludeAssetId } } : {}),
      },
      _sum: { cost: true, purchaseQuantity: true },
    });
    const usedCost = new Prisma.Decimal(others._sum.cost ?? 0);
    const usedQty = new Prisma.Decimal(others._sum.purchaseQuantity ?? 0);
    if (usedCost.plus(input.cost).greaterThan(lineCost)) {
      throw new BadRequestException(
        `Purchase line on ${line.invoice.invoiceNumber} received ${money(lineCost)} and ` +
          `${money(usedCost)} of it is already capitalised in other assets; ` +
          `this asset's ${money(input.cost)} would count the same purchase twice`,
      );
    }
    const quantity =
      input.purchaseQuantity != null && input.purchaseQuantity !== ''
        ? this.amount(input.purchaseQuantity, 'purchaseQuantity')
        : lineQuantity.minus(usedQty);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'The quantity capitalised from a purchase line must be greater than zero',
      );
    }
    if (usedQty.plus(quantity).greaterThan(lineQuantity)) {
      throw new BadRequestException(
        `Purchase line on ${line.invoice.invoiceNumber} received ${money(lineQuantity)} unit(s) ` +
          `(after returns) and ${money(usedQty)} are already capitalised; ` +
          `${money(quantity)} more cannot come from it`,
      );
    }
    return {
      purchaseInvoiceId: line.invoice.id,
      purchaseInvoiceLineId: line.id,
      purchaseQuantity: quantity,
      supplierIdHint: line.invoice.supplierId,
    };
  }

  // ------------------------------------------------------------ register

  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreateFixedAssetDto,
  ) {
    const branch = this.requireBranch(branchId);
    const cost = this.amount(dto.cost, 'cost');
    const salvageValue = this.amount(dto.salvageValue ?? '0', 'salvageValue');
    this.assertEconomics(cost, salvageValue);
    await this.assertAccounts(companyId, dto);
    if (dto.costCenterId) await this.assertCostCenter(companyId, dto.costCenterId);
    if (dto.supplierId) await this.assertExists('supplier', companyId, dto.supplierId);
    if (dto.purchaseInvoiceId) {
      await this.assertExists('purchase invoice', companyId, dto.purchaseInvoiceId);
    }

    const created = await this.prisma
      .$transaction(async (tx) => {
        const link = await this.resolvePurchaseLink(tx, companyId, {
          purchaseInvoiceId: dto.purchaseInvoiceId,
          purchaseInvoiceLineId: dto.purchaseInvoiceLineId,
          purchaseQuantity: dto.purchaseQuantity,
          cost,
        });
        const code =
          dto.code?.trim() ||
          (await this.numbers.next(tx, companyId, 'FIXED_ASSET', 'FA'));
        return tx.fixedAsset.create({
          data: {
            companyId,
            branchId: branch,
            code,
            nameEn: dto.nameEn.trim(),
            nameAr: dto.nameAr.trim(),
            description: dto.description?.trim() || null,
            category: dto.category?.trim() || null,
            purchaseDate: this.date(dto.purchaseDate, 'purchaseDate'),
            inServiceDate: this.date(dto.inServiceDate, 'inServiceDate'),
            supplierId: dto.supplierId ?? link.supplierIdHint,
            purchaseInvoiceId: link.purchaseInvoiceId,
            purchaseInvoiceLineId: link.purchaseInvoiceLineId,
            purchaseQuantity: link.purchaseQuantity,
            cost,
            salvageValue,
            usefulLifeMonths: dto.usefulLifeMonths,
            assetAccountId: dto.assetAccountId,
            accumulatedAccountId: dto.accumulatedAccountId,
            expenseAccountId: dto.expenseAccountId,
            costCenterId: dto.costCenterId ?? null,
            location: dto.location?.trim() || null,
            createdBy: userId,
          },
        });
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('An asset with that code already exists');
        }
        throw error;
      });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'fixed_assets',
      entityId: created.id,
      after: { code: created.code, cost: money(cost) },
    });
    return this.findOne(companyId, created.id);
  }

  async findAll(companyId: string, query: ListFixedAssetsDto) {
    const where: Prisma.FixedAssetWhereInput = { companyId, deletedAt: null };
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!Object.values(FixedAssetStatus).includes(status as FixedAssetStatus)) {
        throw new BadRequestException(`Unknown asset status: ${query.status}`);
      }
      where.status = status as FixedAssetStatus;
    }
    if (query.category) where.category = query.category;
    if (query.location) {
      where.location = { contains: query.location, mode: 'insensitive' };
    }
    if (query.costCenterId) where.costCenterId = query.costCenterId;
    if (query.from || query.to) {
      where.inServiceDate = {
        ...(query.from ? { gte: this.date(query.from, 'from') } : {}),
        ...(query.to ? { lte: this.date(query.to, 'to') } : {}),
      };
    }
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { nameEn: { contains: query.q, mode: 'insensitive' } },
        { nameAr: { contains: query.q } },
        { location: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const assets = await this.prisma.fixedAsset.findMany({
      where,
      orderBy: { code: 'asc' },
    });
    const ids = assets.map((a) => a.id);
    const [accumulated, lastPeriods] = await Promise.all([
      this.accumulatedByAsset(companyId, ids),
      this.lastDepreciationByAsset(companyId, ids),
    ]);
    return {
      items: assets.map((asset) =>
        this.present(
          asset,
          accumulated.get(asset.id) ?? new Prisma.Decimal(0),
          lastPeriods.get(asset.id) ?? null,
        ),
      ),
    };
  }

  async findOne(companyId: string, id: string) {
    const asset = await this.get(companyId, id);
    const rows = await this.prisma.assetDepreciation.findMany({
      where: { assetId: id, companyId },
      orderBy: { periodKey: 'asc' },
      include: { run: { select: { runNumber: true, runDate: true } } },
    });
    const accumulated = rows.reduce(
      (sum, row) => sum.plus(row.amount),
      new Prisma.Decimal(0),
    );
    // Entry numbers, so the detail view can name the journal entries an
    // accountant will go looking for instead of showing bare ids.
    const entryIds = [
      ...new Set(
        [
          asset.acquisitionJournalEntryId,
          asset.disposalJournalEntryId,
          ...rows.map((row) => row.journalEntryId),
        ].filter((v): v is string => Boolean(v)),
      ),
    ];
    const entries =
      entryIds.length > 0
        ? await this.prisma.journalEntry.findMany({
            where: { id: { in: entryIds }, companyId },
            select: { id: true, entryNumber: true },
          })
        : [];
    const numberOf = new Map(entries.map((e) => [e.id, e.entryNumber]));
    return {
      ...this.present(asset, accumulated, rows.at(-1)?.periodKey ?? null),
      acquisitionEntryNumber: asset.acquisitionJournalEntryId
        ? (numberOf.get(asset.acquisitionJournalEntryId) ?? null)
        : null,
      disposalEntryNumber: asset.disposalJournalEntryId
        ? (numberOf.get(asset.disposalJournalEntryId) ?? null)
        : null,
      depreciations: rows.map((row) => ({
        id: row.id,
        period: row.periodKey,
        runNumber: row.run.runNumber,
        runDate: day(row.run.runDate),
        amount: money(row.amount),
        accumulatedAfter: money(row.accumulatedAfter),
        journalEntryId: row.journalEntryId,
        entryNumber: numberOf.get(row.journalEntryId) ?? null,
      })),
    };
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateFixedAssetDto,
  ) {
    const asset = await this.get(companyId, id);
    if (asset.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException(
        'Only a draft asset can be edited; an active asset is corrected through disposal or a journal, not by rewriting its cost',
      );
    }
    const cost = dto.cost !== undefined ? this.amount(dto.cost, 'cost') : asset.cost;
    const salvageValue =
      dto.salvageValue !== undefined
        ? this.amount(dto.salvageValue, 'salvageValue')
        : asset.salvageValue;
    this.assertEconomics(cost, salvageValue);
    await this.assertAccounts(companyId, {
      assetAccountId: dto.assetAccountId ?? asset.assetAccountId,
      accumulatedAccountId: dto.accumulatedAccountId ?? asset.accumulatedAccountId,
      expenseAccountId: dto.expenseAccountId ?? asset.expenseAccountId,
    });

    await this.prisma.$transaction(async (tx) => {
      const link = await this.resolvePurchaseLink(tx, companyId, {
        purchaseInvoiceId:
          dto.purchaseInvoiceId === undefined
            ? asset.purchaseInvoiceId
            : dto.purchaseInvoiceId,
        purchaseInvoiceLineId:
          dto.purchaseInvoiceLineId === undefined
            ? asset.purchaseInvoiceLineId
            : dto.purchaseInvoiceLineId,
        purchaseQuantity:
          dto.purchaseQuantity === undefined
            ? asset.purchaseQuantity?.toString()
            : dto.purchaseQuantity,
        cost,
        excludeAssetId: id,
      });
      await tx.fixedAsset.update({
      where: { id },
      data: {
        nameEn: dto.nameEn?.trim(),
        nameAr: dto.nameAr?.trim(),
        description:
          dto.description === undefined ? undefined : dto.description?.trim() || null,
        category: dto.category === undefined ? undefined : dto.category?.trim() || null,
        purchaseDate: dto.purchaseDate ? this.date(dto.purchaseDate, 'purchaseDate') : undefined,
        inServiceDate: dto.inServiceDate
          ? this.date(dto.inServiceDate, 'inServiceDate')
          : undefined,
        supplierId: dto.supplierId === undefined ? undefined : dto.supplierId,
        purchaseInvoiceId: link.purchaseInvoiceId,
        purchaseInvoiceLineId: link.purchaseInvoiceLineId,
        purchaseQuantity: link.purchaseQuantity,
        cost,
        salvageValue,
        usefulLifeMonths: dto.usefulLifeMonths,
        assetAccountId: dto.assetAccountId,
        accumulatedAccountId: dto.accumulatedAccountId,
        expenseAccountId: dto.expenseAccountId,
        costCenterId: dto.costCenterId === undefined ? undefined : dto.costCenterId,
        location: dto.location === undefined ? undefined : dto.location?.trim() || null,
        updatedBy: userId,
      },
      });
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'fixed_assets',
      entityId: id,
      after: { code: asset.code },
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, userId: string, id: string) {
    const asset = await this.get(companyId, id);
    if (asset.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException(
        'Only a draft asset can be deleted; an asset on the books leaves through disposal',
      );
    }
    await this.prisma.fixedAsset.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'fixed_assets',
      entityId: id,
      before: { code: asset.code },
    });
    return { id, deleted: true };
  }

  // --------------------------------------------------------- acquisition

  async activate(
    companyId: string,
    userId: string,
    id: string,
    dto: ActivateFixedAssetDto,
  ) {
    const entry = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.fixedAsset.updateMany({
        where: { id, companyId, deletedAt: null, status: FixedAssetStatus.DRAFT },
        data: { status: FixedAssetStatus.ACTIVE, updatedBy: userId },
      });
      if (claim.count !== 1) {
        const asset = await tx.fixedAsset.findFirst({ where: { id, companyId } });
        if (!asset) throw new NotFoundException('Fixed asset not found');
        throw new BadRequestException(
          `Only a draft asset can be activated (current status: ${asset.status})`,
        );
      }
      const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      await this.assertPostableAccount(tx, companyId, dto.fundingAccountId, 'funding');
      const entryDate = dto.date ? this.date(dto.date, 'date') : asset.purchaseDate;

      // An asset capitalised from a purchase invoice has already been
      // paid for once — by the invoice, into inventory. Activation is
      // therefore a reclassification out of inventory, never a second
      // cost: the invoice must be posted (a draft would debit inventory
      // later, on top of the asset), and the funding side must be the
      // inventory account itself.
      let linkedInvoice: {
        invoiceNumber: string;
        warehouseId: string | null;
      } | null = null;
      if (asset.purchaseInvoiceId) {
        const invoice = await tx.purchaseInvoice.findFirst({
          where: { id: asset.purchaseInvoiceId, companyId, deletedAt: null },
          select: { invoiceNumber: true, status: true, warehouseId: true },
        });
        if (!invoice) {
          throw new BadRequestException(
            'The linked purchase invoice no longer exists, so this asset cannot be activated against it',
          );
        }
        if (invoice.status !== InvoiceStatus.POSTED) {
          throw new BadRequestException(
            `Purchase invoice ${invoice.invoiceNumber} is not posted yet. ` +
              'Post it first — activating now would record the cost twice when the invoice posts.',
          );
        }
        const accounts = await this.accountMap.resolve(tx, companyId, ['inventory']);
        if (dto.fundingAccountId !== accounts.inventory) {
          throw new BadRequestException(
            `This asset came from purchase invoice ${invoice.invoiceNumber}, which already ` +
              'debited the inventory account. Activate it against the inventory account ' +
              'so the cost moves from stock to the asset instead of being recorded twice.',
          );
        }
        linkedInvoice = invoice;
      }

      const posted = await this.posting.post(tx, {
        companyId,
        branchId: asset.branchId,
        userId,
        entryDate,
        description: `Asset acquisition ${asset.code} — ${asset.nameEn}`,
        sourceType: 'FIXED_ASSET',
        sourceId: asset.id,
        sourceNumber: asset.code,
        lines: [
          { accountId: asset.assetAccountId, debit: asset.cost, description: asset.nameEn },
          { accountId: dto.fundingAccountId, credit: asset.cost, description: asset.nameEn },
        ],
      });
      await tx.fixedAsset.update({
        where: { id },
        data: { acquisitionJournalEntryId: posted.id },
      });

      // The units leave stock in the same transaction, at exactly the
      // cost being capitalised, so the stock valuation and the
      // inventory account move together and keep agreeing.
      if (asset.purchaseInvoiceLineId) {
        const quantity = asset.purchaseQuantity;
        if (!quantity || quantity.lessThanOrEqualTo(0)) {
          throw new BadRequestException(
            'This asset is linked to a purchase line but records no quantity to issue from stock',
          );
        }
        const line = await tx.purchaseInvoiceLine.findFirst({
          where: { id: asset.purchaseInvoiceLineId },
          select: { itemId: true, unitName: true, unitQuantity: true, unitFactor: true },
        });
        if (!line?.itemId) {
          throw new BadRequestException(
            'The linked purchase line has no stocked item to issue',
          );
        }
        const warehouseId = await this.warehouses.resolve(
          tx,
          companyId,
          asset.branchId,
          linkedInvoice?.warehouseId ?? null,
        );
        const locked = await tx.$queryRaw<
          Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
        >(Prisma.sql`
          SELECT "quantity", "value"
            FROM "stock_balances"
           WHERE "companyId" = ${companyId}::uuid
             AND "branchId" = ${asset.branchId}::uuid
             AND "itemId" = ${line.itemId}::uuid
           FOR UPDATE
        `);
        const balance = locked[0] ?? null;
        const qtyOnHand = balance?.quantity ?? new Prisma.Decimal(0);
        const valueOnHand = balance?.value ?? new Prisma.Decimal(0);
        if (qtyOnHand.lessThan(quantity) || valueOnHand.lessThan(asset.cost)) {
          throw new BadRequestException(
            `Cannot capitalise from stock: ${money(qtyOnHand)} unit(s) worth ${money(valueOnHand)} ` +
              `are on hand, but this asset needs ${money(quantity)} unit(s) worth ${money(asset.cost)}. ` +
              'The stock may already have been sold or moved.',
          );
        }
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: asset.branchId,
            warehouseId,
            itemId: line.itemId,
            movementDate: entryDate,
            direction: StockDirection.OUT,
            quantity,
            // The purchase line already knows how the goods were bought; the
            // capitalisation movement repeats it rather than inventing one.
            ...movementUnitSnapshot({
              enteredUnit: line.unitName,
              enteredQuantity: line.unitQuantity,
              unitFactor: line.unitFactor,
              baseUnitName: 'unit',
              baseQuantity: quantity,
            }),
            unitCost: asset.cost.div(quantity).toDecimalPlaces(MONEY_SCALE),
            totalCost: asset.cost,
            referenceType: 'FIXED_ASSET_ACTIVATION',
            referenceId: asset.id,
            referenceNumber: asset.code,
            notes: `Capitalised as fixed asset ${asset.code}`,
            createdBy: userId,
          },
        });
        await tx.stockBalance.update({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: asset.branchId,
              itemId: line.itemId,
            },
          },
          data: {
            quantity: { decrement: quantity },
            value: { decrement: asset.cost },
          },
        });
      }
      return posted;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'ACTIVATE',
      entity: 'fixed_assets',
      entityId: id,
      after: { journalEntryId: entry.id, entryNumber: entry.entryNumber },
    });
    return this.findOne(companyId, id);
  }

  // -------------------------------------------------------- depreciation

  async runDepreciation(
    companyId: string,
    branchIdInput: string | null,
    userId: string,
    dto: RunDepreciationDto,
  ) {
    const branchId = this.requireBranch(branchIdInput);
    const periodKey = dto.period;
    const runDate = monthEndOf(periodKey);

    const outcome = await this.prisma
      .$transaction(async (tx) => {
        const assets = await tx.fixedAsset.findMany({
          where: {
            companyId,
            branchId,
            deletedAt: null,
            status: FixedAssetStatus.ACTIVE,
            ...(dto.assetIds?.length ? { id: { in: dto.assetIds } } : {}),
          },
          orderBy: { code: 'asc' },
        });
        const ids = assets.map((a) => a.id);
        const accumulated = await this.accumulatedByAsset(companyId, ids, tx);
        const already = new Set(
          (
            await tx.assetDepreciation.findMany({
              where: { companyId, periodKey, assetId: { in: ids } },
              select: { assetId: true },
            })
          ).map((row) => row.assetId),
        );

        const eligible: Array<{
          asset: FixedAsset;
          amount: Prisma.Decimal;
          accumulatedAfter: Prisma.Decimal;
        }> = [];
        const skipped: Array<{ assetId: string; code: string; reason: string }> = [];
        for (const asset of assets) {
          if (already.has(asset.id)) {
            skipped.push({
              assetId: asset.id,
              code: asset.code,
              reason: `already depreciated for ${periodKey}`,
            });
            continue;
          }
          if (periodKeyOf(asset.inServiceDate) > periodKey) {
            skipped.push({
              assetId: asset.id,
              code: asset.code,
              reason: `enters service on ${day(asset.inServiceDate)}, after ${periodKey}`,
            });
            continue;
          }
          const soFar = accumulated.get(asset.id) ?? new Prisma.Decimal(0);
          const amount = nextCharge(
            asset.cost,
            asset.salvageValue,
            asset.usefulLifeMonths,
            soFar,
          );
          if (amount.lessThanOrEqualTo(0)) {
            skipped.push({
              assetId: asset.id,
              code: asset.code,
              reason: 'fully depreciated: book value is at salvage value',
            });
            continue;
          }
          eligible.push({ asset, amount, accumulatedAfter: soFar.plus(amount) });
        }

        if (eligible.length === 0) {
          const reasons = skipped
            .map((row) => `${row.code}: ${row.reason}`)
            .join('; ');
          throw new BadRequestException(
            `Nothing to depreciate for ${periodKey}${reasons ? ` — ${reasons}` : ''}`,
          );
        }

        const runNumber = await this.numbers.next(tx, companyId, 'DEPRECIATION_RUN', 'DEP');
        const total = eligible.reduce(
          (sum, row) => sum.plus(row.amount),
          new Prisma.Decimal(0),
        );
        const run = await tx.depreciationRun.create({
          data: {
            companyId,
            branchId,
            runNumber,
            periodKey,
            runDate,
            totalAmount: total,
            createdBy: userId,
          },
        });

        const lines: PostingLine[] = eligible.flatMap(({ asset, amount }) => [
          {
            accountId: asset.expenseAccountId,
            debit: amount,
            costCenterId: asset.costCenterId,
            description: `Depreciation ${periodKey} — ${asset.code}`,
          },
          {
            accountId: asset.accumulatedAccountId,
            credit: amount,
            description: `Depreciation ${periodKey} — ${asset.code}`,
          },
        ]);
        const entry = await this.posting.post(tx, {
          companyId,
          branchId,
          userId,
          entryDate: runDate,
          description: `Depreciation ${periodKey} (${runNumber})`,
          sourceType: 'ASSET_DEPRECIATION',
          sourceId: run.id,
          sourceNumber: runNumber,
          lines,
        });

        for (const { asset, amount, accumulatedAfter } of eligible) {
          await tx.assetDepreciation.create({
            data: {
              companyId,
              runId: run.id,
              assetId: asset.id,
              periodKey,
              amount,
              accumulatedAfter,
              journalEntryId: entry.id,
            },
          });
          if (
            accumulatedAfter.greaterThanOrEqualTo(
              depreciableBase(asset.cost, asset.salvageValue),
            )
          ) {
            await tx.fixedAsset.update({
              where: { id: asset.id },
              data: { status: FixedAssetStatus.FULLY_DEPRECIATED, updatedBy: userId },
            });
          }
        }
        await tx.depreciationRun.update({
          where: { id: run.id },
          data: { journalEntryId: entry.id },
        });

        return {
          run: {
            id: run.id,
            runNumber,
            period: periodKey,
            runDate: day(runDate),
            totalAmount: money(total),
            journalEntryId: entry.id,
            entryNumber: entry.entryNumber,
          },
          depreciated: eligible.map(({ asset, amount, accumulatedAfter }) => ({
            assetId: asset.id,
            code: asset.code,
            amount: money(amount),
            accumulatedAfter: money(accumulatedAfter),
            bookValueAfter: money(bookValue(asset.cost, accumulatedAfter)),
          })),
          skipped,
        };
      })
      .catch((error) => {
        // Two runs racing for the same month: the (asset, period) unique
        // index is the last word. Say so plainly instead of leaking SQL.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(
            `Depreciation for ${periodKey} was already recorded for at least one of these assets`,
          );
        }
        throw error;
      });

    await this.audit.record({
      companyId,
      userId,
      action: 'DEPRECIATE',
      entity: 'depreciation_runs',
      entityId: outcome.run.id,
      after: {
        runNumber: outcome.run.runNumber,
        period: periodKey,
        totalAmount: outcome.run.totalAmount,
        assets: outcome.depreciated.length,
      },
    });
    return outcome;
  }

  async listRuns(companyId: string, query: ListDepreciationRunsDto) {
    const runs = await this.prisma.depreciationRun.findMany({
      where: { companyId, ...(query.period ? { periodKey: query.period } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        lines: {
          include: { asset: { select: { code: true, nameEn: true, nameAr: true } } },
          orderBy: { assetId: 'asc' },
        },
      },
    });
    return {
      items: runs.map((run) => ({
        id: run.id,
        runNumber: run.runNumber,
        period: run.periodKey,
        runDate: day(run.runDate),
        totalAmount: money(run.totalAmount),
        journalEntryId: run.journalEntryId,
        createdAt: run.createdAt.toISOString(),
        lines: run.lines.map((line) => ({
          assetId: line.assetId,
          code: line.asset.code,
          nameEn: line.asset.nameEn,
          nameAr: line.asset.nameAr,
          amount: money(line.amount),
          accumulatedAfter: money(line.accumulatedAfter),
        })),
      })),
    };
  }

  // ------------------------------------------------------------ disposal

  async dispose(
    companyId: string,
    userId: string,
    id: string,
    dto: DisposeFixedAssetDto,
  ) {
    const proceeds = this.amount(dto.proceeds ?? '0', 'proceeds');
    if (proceeds.lessThan(0)) {
      throw new BadRequestException('Disposal proceeds cannot be negative');
    }
    if (proceeds.greaterThan(0) && !dto.proceedsAccountId) {
      throw new BadRequestException(
        'Name the account that received the proceeds (cash, bank or receivable)',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (!asset) throw new NotFoundException('Fixed asset not found');
      if (
        asset.status !== FixedAssetStatus.ACTIVE &&
        asset.status !== FixedAssetStatus.FULLY_DEPRECIATED
      ) {
        throw new BadRequestException(
          `Only an active asset can be disposed of (current status: ${asset.status})`,
        );
      }
      const claim = await tx.fixedAsset.updateMany({
        where: {
          id,
          companyId,
          status: { in: [FixedAssetStatus.ACTIVE, FixedAssetStatus.FULLY_DEPRECIATED] },
        },
        data: {
          status: FixedAssetStatus.DISPOSED,
          disposalDate: this.date(dto.date, 'date'),
          disposalProceeds: proceeds,
          updatedBy: userId,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('The asset was disposed of by another request');
      }

      const accumulated =
        (await this.accumulatedByAsset(companyId, [id], tx)).get(id) ??
        new Prisma.Decimal(0);
      const gain = disposalResult(asset.cost, accumulated, proceeds);
      const mapped = await this.accountMap.resolve(tx, companyId, [
        'assetDisposalGain',
        'assetDisposalLoss',
      ]);

      const lines: PostingLine[] = [];
      if (accumulated.greaterThan(0)) {
        lines.push({
          accountId: asset.accumulatedAccountId,
          debit: accumulated,
          description: `Disposal of ${asset.code} — accumulated depreciation cleared`,
        });
      }
      if (proceeds.greaterThan(0) && dto.proceedsAccountId) {
        lines.push({
          accountId: dto.proceedsAccountId,
          debit: proceeds,
          description: `Disposal of ${asset.code} — proceeds`,
        });
      }
      lines.push({
        accountId: asset.assetAccountId,
        credit: asset.cost,
        description: `Disposal of ${asset.code} — cost removed`,
      });
      if (gain.greaterThan(0)) {
        lines.push({
          accountId: dto.gainLossAccountId ?? mapped.assetDisposalGain,
          credit: gain,
          description: `Gain on disposal of ${asset.code}`,
        });
      } else if (gain.lessThan(0)) {
        lines.push({
          accountId: dto.gainLossAccountId ?? mapped.assetDisposalLoss,
          debit: gain.negated(),
          costCenterId: asset.costCenterId,
          description: `Loss on disposal of ${asset.code}`,
        });
      }

      const entry = await this.posting.post(tx, {
        companyId,
        branchId: asset.branchId,
        userId,
        entryDate: this.date(dto.date, 'date'),
        description: `Disposal of asset ${asset.code} — ${asset.nameEn}`,
        sourceType: 'ASSET_DISPOSAL',
        sourceId: asset.id,
        sourceNumber: asset.code,
        lines,
      });
      await tx.fixedAsset.update({
        where: { id },
        data: { disposalJournalEntryId: entry.id },
      });
      return {
        journalEntryId: entry.id,
        entryNumber: entry.entryNumber,
        cost: money(asset.cost),
        accumulatedDepreciation: money(accumulated),
        bookValue: money(bookValue(asset.cost, accumulated)),
        proceeds: money(proceeds),
        gainOrLoss: money(gain),
      };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DISPOSE',
      entity: 'fixed_assets',
      entityId: id,
      after: result,
    });
    return { ...(await this.findOne(companyId, id)), disposal: result };
  }

  // ------------------------------------------------------------- reports

  /**
   * The register against the ledger. For every asset-cost and accumulated
   * account in use: what the register says, what the ledger says, and the
   * difference — which is zero unless somebody posted to those accounts
   * outside the register, in which case the difference is shown, not
   * absorbed.
   */
  /**
   * Purchase lines that can still be capitalised: posted invoices
   * only (a draft never reached inventory), each line net of returns
   * and of what other assets already took from it. This is the source
   * list the register form offers, so what can be picked is exactly
   * what the create-time guard will accept.
   */
  async purchaseLines(companyId: string) {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, deletedAt: null, status: InvoiceStatus.POSTED },
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        supplierId: true,
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            id: true,
            itemId: true,
            description: true,
            quantity: true,
            returnedQuantity: true,
            lineTotal: true,
            inventoryCostTotal: true,
            returnedCostTotal: true,
            item: { select: { code: true } },
          },
        },
      },
    });
    const lineIds = invoices.flatMap((inv) => inv.lines.map((l) => l.id));
    const used =
      lineIds.length > 0
        ? await this.prisma.fixedAsset.groupBy({
            by: ['purchaseInvoiceLineId'],
            where: {
              companyId,
              deletedAt: null,
              purchaseInvoiceLineId: { in: lineIds },
            },
            _sum: { cost: true, purchaseQuantity: true },
          })
        : [];
    const usedByLine = new Map(
      used.map((u) => [
        u.purchaseInvoiceLineId as string,
        {
          cost: new Prisma.Decimal(u._sum.cost ?? 0),
          quantity: new Prisma.Decimal(u._sum.purchaseQuantity ?? 0),
        },
      ]),
    );
    const items: Array<Record<string, string | null>> = [];
    for (const invoice of invoices) {
      for (const line of invoice.lines) {
        const lineCost = (
          line.inventoryCostTotal.isZero() && !line.lineTotal.isZero()
            ? line.lineTotal
            : line.inventoryCostTotal
        ).minus(line.returnedCostTotal);
        const lineQuantity = line.quantity.minus(line.returnedQuantity);
        const taken = usedByLine.get(line.id) ?? {
          cost: new Prisma.Decimal(0),
          quantity: new Prisma.Decimal(0),
        };
        const remainingCost = lineCost.minus(taken.cost);
        const remainingQuantity = lineQuantity.minus(taken.quantity);
        if (remainingCost.lessThanOrEqualTo(0)) continue;
        items.push({
          lineId: line.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: day(invoice.invoiceDate),
          supplierId: invoice.supplierId,
          itemId: line.itemId,
          itemCode: line.item?.code ?? null,
          description: line.description,
          quantity: money(lineQuantity),
          capitalizedCost: money(taken.cost),
          capitalizedQuantity: money(taken.quantity),
          remainingCost: money(remainingCost),
          remainingQuantity: money(remainingQuantity),
        });
      }
    }
    return { items };
  }

  async summary(companyId: string) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: 'asc' },
    });
    const accumulated = await this.accumulatedByAsset(
      companyId,
      assets.map((a) => a.id),
    );
    const onBooks = assets.filter((a) => a.status !== FixedAssetStatus.DISPOSED);
    const activated = onBooks.filter((a) => a.status !== FixedAssetStatus.DRAFT);

    const sum = (rows: FixedAsset[], pick: (a: FixedAsset) => Prisma.Decimal) =>
      rows.reduce((total, a) => total.plus(pick(a)), new Prisma.Decimal(0));
    const totalCost = sum(activated, (a) => a.cost);
    const totalAccumulated = sum(activated, (a) =>
      accumulated.get(a.id) ?? new Prisma.Decimal(0),
    );

    const accountIds = [
      ...new Set([
        ...activated.map((a) => a.assetAccountId),
        ...activated.map((a) => a.accumulatedAccountId),
      ]),
    ];
    const ledger = new Map<string, Prisma.Decimal>();
    if (accountIds.length > 0) {
      const rows = await this.prisma.$queryRaw<
        Array<{ accountId: string; net: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT l."accountId" AS "accountId",
               COALESCE(SUM(l.debit - l.credit), 0) AS net
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l."journalEntryId"
         WHERE e."companyId" = ${companyId}::uuid
           AND e.status IN ('POSTED', 'REVERSED')
           AND l."accountId" IN (${Prisma.join(accountIds.map((v) => Prisma.sql`${v}::uuid`))})
         GROUP BY l."accountId"
      `);
      for (const row of rows) ledger.set(row.accountId, new Prisma.Decimal(row.net));
    }
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    const accountOf = (id: string) => accounts.find((a) => a.id === id);

    const group = (
      pick: (a: FixedAsset) => string,
      register: (rows: FixedAsset[]) => Prisma.Decimal,
      ledgerOf: (id: string) => Prisma.Decimal,
    ) => {
      const byAccount = new Map<string, FixedAsset[]>();
      for (const asset of activated) {
        const key = pick(asset);
        byAccount.set(key, [...(byAccount.get(key) ?? []), asset]);
      }
      return [...byAccount.entries()].map(([accountId, rows]) => {
        const registerAmount = register(rows);
        const ledgerAmount = ledgerOf(accountId);
        const meta = accountOf(accountId);
        return {
          accountId,
          code: meta?.code ?? '',
          nameEn: meta?.nameEn ?? '',
          nameAr: meta?.nameAr ?? '',
          register: money(registerAmount),
          ledger: money(ledgerAmount),
          difference: money(ledgerAmount.minus(registerAmount)),
        };
      });
    };

    return {
      counts: {
        draft: assets.filter((a) => a.status === FixedAssetStatus.DRAFT).length,
        active: assets.filter((a) => a.status === FixedAssetStatus.ACTIVE).length,
        fullyDepreciated: assets.filter(
          (a) => a.status === FixedAssetStatus.FULLY_DEPRECIATED,
        ).length,
        disposed: assets.filter((a) => a.status === FixedAssetStatus.DISPOSED).length,
      },
      totals: {
        cost: money(totalCost),
        accumulatedDepreciation: money(totalAccumulated),
        bookValue: money(totalCost.minus(totalAccumulated)),
      },
      // Asset accounts carry cost as a debit balance; accumulated
      // depreciation carries its total as a credit balance, presented
      // positive so both sides of each row read the same way.
      assetAccounts: group(
        (a) => a.assetAccountId,
        (rows) => sum(rows, (a) => a.cost),
        (id) => ledger.get(id) ?? new Prisma.Decimal(0),
      ),
      accumulatedAccounts: group(
        (a) => a.accumulatedAccountId,
        (rows) => sum(rows, (a) => accumulated.get(a.id) ?? new Prisma.Decimal(0)),
        (id) => (ledger.get(id) ?? new Prisma.Decimal(0)).negated(),
      ),
      items: assets.map((asset) =>
        this.present(asset, accumulated.get(asset.id) ?? new Prisma.Decimal(0)),
      ),
    };
  }

  // -------------------------------------------------------------- helpers

  private requireBranch(branchId: string | null): string {
    if (!branchId) {
      throw new BadRequestException(
        'Your session is not attached to a branch, so it cannot own assets or depreciation runs',
      );
    }
    return branchId;
  }

  private present(
    asset: FixedAsset,
    accumulated: Prisma.Decimal,
    lastDepreciationPeriod: string | null = null,
  ) {
    return {
      id: asset.id,
      code: asset.code,
      nameEn: asset.nameEn,
      nameAr: asset.nameAr,
      description: asset.description,
      category: asset.category,
      purchaseDate: day(asset.purchaseDate),
      inServiceDate: day(asset.inServiceDate),
      supplierId: asset.supplierId,
      purchaseInvoiceId: asset.purchaseInvoiceId,
      purchaseInvoiceLineId: asset.purchaseInvoiceLineId,
      purchaseQuantity:
        asset.purchaseQuantity !== null ? money(asset.purchaseQuantity) : null,
      lastDepreciationPeriod,
      cost: money(asset.cost),
      salvageValue: money(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
      method: asset.method,
      assetAccountId: asset.assetAccountId,
      accumulatedAccountId: asset.accumulatedAccountId,
      expenseAccountId: asset.expenseAccountId,
      costCenterId: asset.costCenterId,
      location: asset.location,
      status: asset.status,
      acquisitionJournalEntryId: asset.acquisitionJournalEntryId,
      disposalDate: asset.disposalDate ? day(asset.disposalDate) : null,
      disposalProceeds:
        asset.disposalProceeds !== null ? money(asset.disposalProceeds) : null,
      disposalJournalEntryId: asset.disposalJournalEntryId,
      accumulatedDepreciation: money(accumulated),
      bookValue: money(bookValue(asset.cost, accumulated)),
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    };
  }

  private async get(companyId: string, id: string): Promise<FixedAsset> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return asset;
  }

  /** The most recent month each asset was charged for, for the register. */
  private async lastDepreciationByAsset(
    companyId: string,
    assetIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (assetIds.length === 0) return result;
    const rows = await this.prisma.assetDepreciation.groupBy({
      by: ['assetId'],
      where: { companyId, assetId: { in: assetIds } },
      _max: { periodKey: true },
    });
    for (const row of rows) {
      if (row._max.periodKey) result.set(row.assetId, row._max.periodKey);
    }
    return result;
  }

  private async accumulatedByAsset(
    companyId: string,
    assetIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, Prisma.Decimal>> {
    const client = tx ?? this.prisma;
    const result = new Map<string, Prisma.Decimal>();
    if (assetIds.length === 0) return result;
    const rows = await client.assetDepreciation.groupBy({
      by: ['assetId'],
      where: { companyId, assetId: { in: assetIds } },
      _sum: { amount: true },
    });
    for (const row of rows) {
      result.set(row.assetId, new Prisma.Decimal(row._sum.amount ?? 0));
    }
    return result;
  }

  private async assertAccounts(
    companyId: string,
    ids: {
      assetAccountId: string;
      accumulatedAccountId: string;
      expenseAccountId: string;
    },
  ) {
    const expectations: Array<[string, AccountType, string]> = [
      [ids.assetAccountId, AccountType.ASSET, 'asset'],
      [ids.accumulatedAccountId, AccountType.ASSET, 'accumulated depreciation'],
      [ids.expenseAccountId, AccountType.EXPENSE, 'depreciation expense'],
    ];
    const accounts = await this.prisma.account.findMany({
      where: { companyId, deletedAt: null, id: { in: expectations.map(([id]) => id) } },
      select: { id: true, code: true, type: true, isPostable: true, isActive: true },
    });
    for (const [id, type, role] of expectations) {
      const account = accounts.find((a) => a.id === id);
      if (!account) {
        throw new BadRequestException(`The ${role} account does not exist in this company`);
      }
      if (account.type !== type) {
        throw new BadRequestException(
          `The ${role} account (${account.code}) must be an ${type} account`,
        );
      }
      if (!account.isPostable || !account.isActive) {
        throw new BadRequestException(
          `The ${role} account (${account.code}) cannot receive postings`,
        );
      }
    }
    if (ids.assetAccountId === ids.accumulatedAccountId) {
      throw new BadRequestException(
        'The asset and accumulated depreciation accounts must be different accounts',
      );
    }
  }

  private async assertPostableAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
    role: string,
  ) {
    const account = await tx.account.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { code: true, isPostable: true, isActive: true },
    });
    if (!account) {
      throw new BadRequestException(`The ${role} account does not exist in this company`);
    }
    if (!account.isPostable || !account.isActive) {
      throw new BadRequestException(`Account ${account.code} cannot receive postings`);
    }
  }

  private async assertCostCenter(companyId: string, id: string) {
    const center = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!center) throw new BadRequestException('The cost center does not exist in this company');
  }

  private async assertExists(
    what: 'supplier' | 'purchase invoice',
    companyId: string,
    id: string,
  ) {
    const found =
      what === 'supplier'
        ? await this.prisma.supplier.findFirst({
            where: { id, companyId, deletedAt: null },
            select: { id: true },
          })
        : await this.prisma.purchaseInvoice.findFirst({
            where: { id, companyId, deletedAt: null },
            select: { id: true },
          });
    if (!found) throw new BadRequestException(`The ${what} does not exist in this company`);
  }

  private assertEconomics(cost: Prisma.Decimal, salvageValue: Prisma.Decimal) {
    if (cost.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Asset cost must be greater than zero');
    }
    if (salvageValue.lessThan(0)) {
      throw new BadRequestException('Salvage value cannot be negative');
    }
    if (salvageValue.greaterThanOrEqualTo(cost)) {
      throw new BadRequestException(
        'Salvage value must be less than cost; otherwise there is nothing to depreciate',
      );
    }
  }

  private amount(value: string, field: string): Prisma.Decimal {
    try {
      const parsed = new Prisma.Decimal(value);
      if (!parsed.isFinite()) throw new Error('not finite');
      return parsed;
    } catch {
      throw new BadRequestException(`The ${field} amount is not a valid number: ${value}`);
    }
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`The ${field} is not a valid date: ${value}`);
    }
    return parsed;
  }
}
