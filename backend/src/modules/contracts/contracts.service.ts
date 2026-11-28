import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { amount, asHttp, ContractError, claimFigures, isoDate, percent } from './contract-rules';

type ContractRow = {
  id: string; code: string; titleAr: string; customerId: string; serviceItemId: string; costCenterId: string | null;
  contractValue: Prisma.Decimal; advanceAmount: Prisma.Decimal; retentionPercent: Prisma.Decimal;
  taxRatePercent: Prisma.Decimal | null; startDate: Date | null; status: string;
};
type ClaimRow = {
  id: string; contractId: string; claimNo: number; claimDate: Date; cumulativeWork: Prisma.Decimal; previousWork: Prisma.Decimal;
  periodWork: Prisma.Decimal; advanceRecovery: Prisma.Decimal; retention: Prisma.Decimal; status: string; note: string | null;
  salesInvoiceId: string | null; preparedBy: string | null; approvedBy: string | null;
};

export interface ContractInput {
  code?: string; titleAr?: string; customerId?: string; serviceItemId?: string; costCenterId?: string | null;
  contractValue?: unknown; advanceAmount?: unknown; retentionPercent?: unknown; taxRatePercent?: unknown; startDate?: string | null;
}

const n2 = (d: Prisma.Decimal | null | undefined) => (d ?? new Prisma.Decimal(0)).toFixed(2);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: SalesInvoicesService,
  ) {}

  private async contractRow(companyId: string, id: string): Promise<ContractRow> {
    const rows = await this.prisma.$queryRaw<ContractRow[]>(Prisma.sql`
      SELECT * FROM contracts WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!rows[0]) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract not found' });
    return rows[0];
  }

  private async totals(contractId: string) {
    const [v] = await this.prisma.$queryRaw<{ s: Prisma.Decimal }[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount),0) s FROM contract_variations WHERE "contractId" = ${contractId}::uuid`);
    const [c] = await this.prisma.$queryRaw<{ work: Prisma.Decimal; recovered: Prisma.Decimal; held: Prisma.Decimal; open: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM("periodWork") FILTER (WHERE status='INVOICED'),0) work,
             COALESCE(SUM("advanceRecovery") FILTER (WHERE status='INVOICED'),0) recovered,
             COALESCE(SUM(retention) FILTER (WHERE status='INVOICED'),0) held,
             COUNT(*) FILTER (WHERE status IN ('DRAFT','APPROVED')) "open"
      FROM contract_claims WHERE "contractId" = ${contractId}::uuid`);
    const [rel] = await this.prisma.$queryRaw<{ s: Prisma.Decimal }[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount),0) s FROM contract_retention_releases WHERE "contractId" = ${contractId}::uuid`);
    return { variations: v.s, billed: c.work, recovered: c.recovered, retentionHeld: new Prisma.Decimal(c.held).minus(rel.s), released: rel.s, openClaims: Number(c.open) };
  }

  private view(c: ContractRow, t: Awaited<ReturnType<ContractsService['totals']>>) {
    const effective = new Prisma.Decimal(c.contractValue).plus(t.variations);
    return {
      id: c.id, code: c.code, titleAr: c.titleAr, customerId: c.customerId, serviceItemId: c.serviceItemId, costCenterId: c.costCenterId,
      contractValue: n2(c.contractValue), variations: n2(t.variations), effectiveValue: n2(effective),
      advanceAmount: n2(c.advanceAmount), advanceRecovered: n2(t.recovered),
      retentionPercent: Number(c.retentionPercent), taxRatePercent: c.taxRatePercent == null ? null : Number(c.taxRatePercent),
      startDate: day(c.startDate), status: c.status, billedWork: n2(t.billed), remainingWork: n2(effective.minus(t.billed)),
      retentionHeld: n2(t.retentionHeld), retentionReleased: n2(t.released), openClaims: t.openClaims,
    };
  }

  async list(companyId: string) {
    const rows = await this.prisma.$queryRaw<ContractRow[]>(Prisma.sql`
      SELECT * FROM contracts WHERE "companyId" = ${companyId}::uuid ORDER BY status, "createdAt" DESC`);
    const items = [];
    for (const r of rows) items.push(this.view(r, await this.totals(r.id)));
    return { items };
  }

  async get(companyId: string, id: string) {
    const c = await this.contractRow(companyId, id);
    const claims = await this.prisma.$queryRaw<ClaimRow[]>(Prisma.sql`
      SELECT * FROM contract_claims WHERE "contractId" = ${id}::uuid ORDER BY "claimNo"`);
    const variations = await this.prisma.$queryRaw<{ id: string; variationDate: Date; amount: Prisma.Decimal; note: string }[]>(Prisma.sql`
      SELECT id, "variationDate", amount, note FROM contract_variations WHERE "contractId" = ${id}::uuid ORDER BY "variationDate", "createdAt"`);
    const releases = await this.prisma.$queryRaw<{ id: string; releaseDate: Date; amount: Prisma.Decimal; note: string | null }[]>(Prisma.sql`
      SELECT id, "releaseDate", amount, note FROM contract_retention_releases WHERE "contractId" = ${id}::uuid ORDER BY "releaseDate", "createdAt"`);
    return {
      ...this.view(c, await this.totals(id)),
      claims: claims.map((x) => ({
        id: x.id, claimNo: x.claimNo, claimDate: day(x.claimDate), cumulativeWork: n2(x.cumulativeWork), previousWork: n2(x.previousWork),
        periodWork: n2(x.periodWork), advanceRecovery: n2(x.advanceRecovery), retention: n2(x.retention), status: x.status, note: x.note,
        salesInvoiceId: x.salesInvoiceId,
      })),
      variations: variations.map((x) => ({ id: x.id, variationDate: day(x.variationDate), amount: n2(x.amount), note: x.note })),
      releases: releases.map((x) => ({ id: x.id, releaseDate: day(x.releaseDate), amount: n2(x.amount), note: x.note })),
    };
  }

  async create(companyId: string, userId: string, input: ContractInput) {
    try {
      const code = String(input.code ?? '').trim();
      const titleAr = String(input.titleAr ?? '').trim();
      if (!code || code.length > 32) throw new ContractError('CONTRACT_CODE_BAD', 'Contract code is required, up to 32 characters');
      if (!titleAr || titleAr.length > 200) throw new ContractError('CONTRACT_TITLE_BAD', 'Contract title is required, up to 200 characters');
      const value = amount(input.contractValue, 'contractValue');
      const advance = amount(input.advanceAmount ?? '0', 'advanceAmount', { allowZero: true });
      if (advance.gt(value)) throw new ContractError('CONTRACT_ADVANCE_TOO_HIGH', 'The advance is above the contract value');
      const retention = percent(input.retentionPercent, 'retentionPercent');
      const tax = input.taxRatePercent == null || String(input.taxRatePercent).trim() === '' ? null : percent(input.taxRatePercent, 'taxRatePercent');
      const start = input.startDate ? isoDate(input.startDate, 'startDate') : null;
      const customerId = String(input.customerId ?? '');
      const itemId = String(input.serviceItemId ?? '');
      const cust = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM customers WHERE id = ${customerId}::uuid AND "companyId" = ${companyId}::uuid`);
      if (!cust[0]) throw new ContractError('CONTRACT_CUSTOMER_BAD', 'The customer was not found');
      const item = await this.prisma.$queryRaw<{ isStockTracked: boolean }[]>(Prisma.sql`
        SELECT "isStockTracked" FROM items WHERE id = ${itemId}::uuid AND "companyId" = ${companyId}::uuid`);
      if (!item[0] || item[0].isStockTracked) throw new ContractError('CONTRACT_ITEM_NOT_SERVICE', 'The billing item must be a service item');
      const cc = input.costCenterId ? String(input.costCenterId) : null;
      if (cc) {
        const f = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM cost_centers WHERE id = ${cc}::uuid AND "companyId" = ${companyId}::uuid`);
        if (!f[0]) throw new ContractError('CONTRACT_COSTCENTER_BAD', 'The cost centre was not found');
      }
      const dup = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM contracts WHERE "companyId" = ${companyId}::uuid AND lower(code) = lower(${code})`);
      if (dup[0]) throw new ContractError('CONTRACT_CODE_EXISTS', 'A contract with this code already exists', { code });
      const id = randomUUID();
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO contracts (id, "companyId", code, "titleAr", "customerId", "serviceItemId", "costCenterId", "contractValue", "advanceAmount",
          "retentionPercent", "taxRatePercent", "startDate", "createdBy")
        VALUES (${id}::uuid, ${companyId}::uuid, ${code}, ${titleAr}, ${customerId}::uuid, ${itemId}::uuid, ${cc}::uuid, ${value.toFixed(2)}::numeric,
          ${advance.toFixed(2)}::numeric, ${retention.toString()}::numeric, ${tax == null ? null : tax.toString()}::numeric, ${start}::date, ${userId}::uuid)`);
      await this.audit.record({ companyId, userId, action: 'CONTRACT_CREATE', entity: 'contracts', entityId: id, after: { code } });
      return this.get(companyId, id);
    } catch (e) {
      asHttp(e);
    }
  }

  async addVariation(companyId: string, userId: string, id: string, input: { variationDate?: string; amount?: unknown; note?: string }) {
    try {
      const c = await this.contractRow(companyId, id);
      if (c.status !== 'OPEN') throw new ContractError('CONTRACT_CLOSED', 'The contract is closed');
      const date = isoDate(input.variationDate, 'variationDate');
      const amt = amount(input.amount, 'amount', { negative: true });
      const note = String(input.note ?? '').trim();
      if (!note || note.length > 200) throw new ContractError('CONTRACT_NOTE_BAD', 'Write what the change is, up to 200 characters');
      const t = await this.totals(id);
      const newEffective = new Prisma.Decimal(c.contractValue).plus(t.variations).plus(amt);
      if (newEffective.lt(t.billed) || newEffective.lte(0)) throw new ContractError('CONTRACT_VARIATION_BELOW_BILLED', 'The new contract value would be below the work already billed', { billed: n2(t.billed) });
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO contract_variations (id, "contractId", "variationDate", amount, note, "createdBy")
        VALUES (${randomUUID()}::uuid, ${id}::uuid, ${date}::date, ${amt.toFixed(2)}::numeric, ${note}, ${userId}::uuid)`);
      await this.audit.record({ companyId, userId, action: 'CONTRACT_VARIATION', entity: 'contracts', entityId: id, after: { amount: amt.toFixed(2) } });
      return this.get(companyId, id);
    } catch (e) {
      asHttp(e);
    }
  }

  async setStatus(companyId: string, userId: string, id: string, status: 'OPEN' | 'CLOSED') {
    const c = await this.contractRow(companyId, id);
    const t = await this.totals(id);
    try {
      if (status === 'CLOSED' && t.openClaims > 0) throw new ContractError('CONTRACT_OPEN_CLAIMS', 'The contract still has a claim waiting for approval');
    } catch (e) {
      asHttp(e);
    }
    await this.prisma.$executeRaw(Prisma.sql`UPDATE contracts SET status = ${status} WHERE id = ${c.id}::uuid`);
    await this.audit.record({ companyId, userId, action: 'CONTRACT_STATUS', entity: 'contracts', entityId: id, after: { status } });
    return this.get(companyId, id);
  }

  /** What the next claim would be, so the screen can show it before saving. */
  async preview(companyId: string, id: string, cumulativeWork: unknown) {
    try {
      const c = await this.contractRow(companyId, id);
      const t = await this.totals(id);
      const f = claimFigures({
        effectiveValue: new Prisma.Decimal(c.contractValue).plus(t.variations), contractValue: c.contractValue, advanceAmount: c.advanceAmount,
        advanceRecovered: t.recovered, retentionPercent: c.retentionPercent, taxRatePercent: c.taxRatePercent,
        previousWork: t.billed, cumulativeWork: amount(cumulativeWork, 'cumulativeWork').toString(),
      });
      return { periodWork: n2(f.periodWork), advanceRecovery: n2(f.advanceRecovery), retention: n2(f.retention), vat: n2(f.vat), netDueNow: n2(f.netDueNow) };
    } catch (e) {
      asHttp(e);
    }
  }

  async createClaim(companyId: string, userId: string, id: string, input: { claimDate?: string; cumulativeWork?: unknown; note?: string }) {
    try {
      const c = await this.contractRow(companyId, id);
      if (c.status !== 'OPEN') throw new ContractError('CONTRACT_CLOSED', 'The contract is closed');
      const t = await this.totals(id);
      if (t.openClaims > 0) throw new ContractError('CLAIM_ALREADY_OPEN', 'Finish the open claim before preparing another');
      const date = isoDate(input.claimDate, 'claimDate');
      const f = claimFigures({
        effectiveValue: new Prisma.Decimal(c.contractValue).plus(t.variations), contractValue: c.contractValue, advanceAmount: c.advanceAmount,
        advanceRecovered: t.recovered, retentionPercent: c.retentionPercent, taxRatePercent: c.taxRatePercent,
        previousWork: t.billed, cumulativeWork: amount(input.cumulativeWork, 'cumulativeWork').toString(),
      });
      const note = String(input.note ?? '').trim().slice(0, 200) || null;
      const [no] = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COALESCE(MAX("claimNo"),0) + 1 AS n FROM contract_claims WHERE "contractId" = ${id}::uuid`);
      const claimId = randomUUID();
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO contract_claims (id, "contractId", "claimNo", "claimDate", "cumulativeWork", "previousWork", "periodWork", "advanceRecovery", retention, note, "preparedBy")
        VALUES (${claimId}::uuid, ${id}::uuid, ${Number(no.n)}, ${date}::date, ${amount(input.cumulativeWork, 'cumulativeWork').toFixed(2)}::numeric,
          ${t.billed.toString()}::numeric, ${f.periodWork.toFixed(2)}::numeric, ${f.advanceRecovery.toFixed(2)}::numeric, ${f.retention.toFixed(2)}::numeric, ${note}, ${userId}::uuid)`);
      await this.audit.record({ companyId, userId, action: 'CLAIM_CREATE', entity: 'contract_claims', entityId: claimId, after: { claimNo: Number(no.n) } });
      return this.get(companyId, id);
    } catch (e) {
      asHttp(e);
    }
  }

  async cancelClaim(companyId: string, userId: string, claimId: string) {
    const rows = await this.prisma.$queryRaw<{ contractId: string }[]>(Prisma.sql`
      UPDATE contract_claims cc SET status = 'CANCELLED' FROM contracts c
      WHERE cc.id = ${claimId}::uuid AND c.id = cc."contractId" AND c."companyId" = ${companyId}::uuid AND cc.status IN ('DRAFT','APPROVED')
      RETURNING cc."contractId"`);
    if (!rows[0]) {
      try { throw new ContractError('CLAIM_NOT_CANCELLABLE', 'This claim cannot be cancelled'); } catch (e) { asHttp(e); }
    }
    await this.audit.record({ companyId, userId, action: 'CLAIM_CANCEL', entity: 'contract_claims', entityId: claimId });
    return this.get(companyId, rows[0].contractId);
  }

  /** Approve: a different person from the preparer; creates the customer's draft invoice for this period's work. */
  async approveClaim(companyId: string, branchId: string | null, userId: string, claimId: string) {
    try {
      const rows = await this.prisma.$queryRaw<(ClaimRow & { cid: string })[]>(Prisma.sql`
        SELECT cc.*, c.id AS cid FROM contract_claims cc JOIN contracts c ON c.id = cc."contractId"
        WHERE cc.id = ${claimId}::uuid AND c."companyId" = ${companyId}::uuid`);
      const claim = rows[0];
      if (!claim) throw new NotFoundException({ code: 'CLAIM_NOT_FOUND', message: 'Claim not found' });
      if (claim.status !== 'DRAFT') throw new ContractError('CLAIM_NOT_DRAFT', 'This claim was already handled');
      if (claim.preparedBy && claim.preparedBy === userId) throw new ContractError('CLAIM_SAME_PERSON', 'The person who prepared the claim cannot approve it');
      if (!branchId) throw new ContractError('CLAIM_BRANCH_REQUIRED', 'Your user is not linked to a branch, so the invoice cannot be created');
      const c = await this.contractRow(companyId, claim.contractId);
      const inv: any = await this.invoices.create(companyId, branchId, userId, {
        invoiceDate: claim.claimDate.toISOString().slice(0, 10),
        customerId: c.customerId,
        notes: `${c.code} - مستخلص رقم ${claim.claimNo}`,
        lines: [{
          itemId: c.serviceItemId,
          description: `${c.titleAr} - مستخلص رقم ${claim.claimNo}`,
          quantity: '1',
          unitPrice: new Prisma.Decimal(claim.periodWork).toFixed(2),
          taxRate: c.taxRatePercent == null ? '0' : String(c.taxRatePercent),
          ...(c.costCenterId ? { costCenterId: c.costCenterId } : {}),
        }],
      } as any);
      const done = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE contract_claims SET status = 'INVOICED', "salesInvoiceId" = ${inv.id}::uuid, "approvedBy" = ${userId}::uuid, "approvedAt" = now()
        WHERE id = ${claimId}::uuid AND status = 'DRAFT'`);
      if (done !== 1) throw new ContractError('CLAIM_NOT_DRAFT', 'This claim was already handled');
      await this.audit.record({ companyId, userId, action: 'CLAIM_APPROVE', entity: 'contract_claims', entityId: claimId, after: { salesInvoiceId: inv.id } });
      return this.get(companyId, claim.contractId);
    } catch (e) {
      asHttp(e);
    }
  }

  async releaseRetention(companyId: string, userId: string, id: string, input: { releaseDate?: string; amount?: unknown; note?: string }) {
    try {
      await this.contractRow(companyId, id);
      const date = isoDate(input.releaseDate, 'releaseDate');
      const amt = amount(input.amount, 'amount');
      const t = await this.totals(id);
      if (amt.gt(t.retentionHeld)) throw new ContractError('RETENTION_RELEASE_TOO_HIGH', 'The amount is above the retention still held', { held: n2(t.retentionHeld) });
      const note = String(input.note ?? '').trim().slice(0, 200) || null;
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO contract_retention_releases (id, "contractId", "releaseDate", amount, note, "createdBy")
        VALUES (${randomUUID()}::uuid, ${id}::uuid, ${date}::date, ${amt.toFixed(2)}::numeric, ${note}, ${userId}::uuid)`);
      await this.audit.record({ companyId, userId, action: 'RETENTION_RELEASE', entity: 'contracts', entityId: id, after: { amount: amt.toFixed(2) } });
      return this.get(companyId, id);
    } catch (e) {
      asHttp(e);
    }
  }
}
