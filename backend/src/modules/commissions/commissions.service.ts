import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CommissionError, commissionPiasters, invoiceBasis, money, parseRate, payoutTotal, rateToPercent } from './commission-rules';

function fail(field: string, message: string, code = 'VALIDATION'): never {
  throw new BadRequestException({ code, message, field });
}

function rules<T>(field: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CommissionError) fail(field, e.message, e.code);
    throw e;
  }
}

const dateOf = (field: string, v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail(field, 'Enter a date as YYYY-MM-DD');
  return s;
};

type Rep = { id: string; nameEn: string; nameAr: string; ratePercent: Prisma.Decimal; active: boolean };

@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private repView(r: Rep) {
    return { id: r.id, nameEn: r.nameEn, nameAr: r.nameAr, ratePercent: Number(r.ratePercent), active: r.active };
  }

  async listReps(companyId: string) {
    const rows = await this.prisma.$queryRaw<Rep[]>(Prisma.sql`
      SELECT id, "nameEn", "nameAr", "ratePercent", active FROM sales_reps WHERE "companyId" = ${companyId}::uuid ORDER BY active DESC, "nameEn"`);
    return { items: rows.map((r) => this.repView(r)) };
  }

  private names(input: { nameEn?: string; nameAr?: string }) {
    const nameEn = String(input.nameEn ?? '').trim();
    const nameAr = String(input.nameAr ?? '').trim();
    if (!nameEn) fail('nameEn', 'Enter the rep name in English');
    if (!nameAr) fail('nameAr', 'Enter the rep name in Arabic');
    if (nameEn.length > 120 || nameAr.length > 120) fail('nameEn', 'A name can be up to 120 characters');
    return { nameEn, nameAr };
  }

  async createRep(companyId: string, userId: string, input: { nameEn?: string; nameAr?: string; ratePercent?: unknown }) {
    const { nameEn, nameAr } = this.names(input);
    const rate = rules('ratePercent', () => parseRate(input.ratePercent));
    const id = randomUUID();
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO sales_reps (id,"companyId","nameEn","nameAr","ratePercent") VALUES (${id}::uuid, ${companyId}::uuid, ${nameEn}, ${nameAr}, ${rateToPercent(rate)})`);
    } catch (error) {
      if (String((error as Error).message).includes('sales_reps_name')) {
        throw new ConflictException({ code: 'REP_DUPLICATE', message: 'A rep with that name already exists', field: 'nameEn' });
      }
      throw error;
    }
    await this.audit.record({ companyId, userId, action: 'REP_CREATE', entity: 'sales_reps', entityId: id, after: { nameEn, ratePercent: rateToPercent(rate) } });
    return { id };
  }

  /** A new rate applies to documents assigned from now on. Entries already made keep the rate they were made with. */
  async updateRep(companyId: string, userId: string, id: string, input: { nameEn?: string; nameAr?: string; ratePercent?: unknown; active?: boolean }) {
    const [cur] = await this.prisma.$queryRaw<Rep[]>(Prisma.sql`
      SELECT id, "nameEn", "nameAr", "ratePercent", active FROM sales_reps WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!cur) throw new NotFoundException({ code: 'REP_NOT_FOUND', message: 'That rep does not exist' });
    const { nameEn, nameAr } = this.names({ nameEn: input.nameEn ?? cur.nameEn, nameAr: input.nameAr ?? cur.nameAr });
    const rate = input.ratePercent === undefined ? rateToPercent(parseRate(String(cur.ratePercent))) : rateToPercent(rules('ratePercent', () => parseRate(input.ratePercent)));
    const active = input.active === undefined ? cur.active : !!input.active;
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE sales_reps SET "nameEn" = ${nameEn}, "nameAr" = ${nameAr}, "ratePercent" = ${rate}, active = ${active}, "updatedAt" = now() WHERE id = ${id}::uuid`);
    } catch (error) {
      if (String((error as Error).message).includes('sales_reps_name')) {
        throw new ConflictException({ code: 'REP_DUPLICATE', message: 'A rep with that name already exists', field: 'nameEn' });
      }
      throw error;
    }
    await this.audit.record({ companyId, userId, action: 'REP_UPDATE', entity: 'sales_reps', entityId: id, after: { nameEn, ratePercent: rate, active } });
    return { id };
  }

  /**
   * Puts a posted sales invoice under a rep. A credit note takes the rep and rate
   * of the invoice it returns and records a negative entry; its rep cannot be chosen.
   */
  async assign(companyId: string, userId: string, input: { salesInvoiceId?: string; repId?: string }) {
    if (!input.salesInvoiceId) fail('salesInvoiceId', 'Choose the sales invoice');
    const result = await this.prisma.$transaction(async (tx) => {
      const [doc] = await tx.$queryRaw<{ id: string; status: string; documentType: string; originalInvoiceId: string | null; invoiceDate: Date; totalAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; invoiceNumber: string }[]>(Prisma.sql`
        SELECT id, status::text AS status, "documentType"::text AS "documentType", "originalInvoiceId", "invoiceDate", "totalAmount", "taxAmount", "invoiceNumber"
          FROM sales_invoices WHERE id = ${String(input.salesInvoiceId)}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL FOR UPDATE`);
      if (!doc) fail('salesInvoiceId', 'That sales document does not exist');
      if (doc.status !== 'POSTED') fail('salesInvoiceId', 'Commission is set on a posted document', 'COMMISSION_DOC_NOT_POSTED');
      if (doc.documentType === 'DEBIT_NOTE') fail('salesInvoiceId', 'Debit notes do not carry commission', 'COMMISSION_DEBIT_NOTE');
      const [exists] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM commission_entries WHERE "salesInvoiceId" = ${doc.id}::uuid`);
      if (exists) throw new ConflictException({ code: 'COMMISSION_EXISTS', message: `${doc.invoiceNumber} already has a commission entry`, field: 'salesInvoiceId' });
      const basisP = invoiceBasis(doc.totalAmount.toString(), doc.taxAmount.toString());
      let repId: string; let rate: number; let kind: 'SALE' | 'RETURN';
      if (doc.documentType === 'CREDIT_NOTE') {
        if (!doc.originalInvoiceId) fail('salesInvoiceId', 'This credit note does not name the invoice it returns', 'COMMISSION_CREDIT_NO_ORIGINAL');
        const [orig] = await tx.$queryRaw<{ repId: string; ratePercent: Prisma.Decimal }[]>(Prisma.sql`
          SELECT "repId", "ratePercent" FROM commission_entries WHERE "salesInvoiceId" = ${doc.originalInvoiceId}::uuid`);
        if (!orig) fail('salesInvoiceId', 'The invoice it returns has no commission entry, so there is nothing to take back', 'COMMISSION_ORIGINAL_UNASSIGNED');
        repId = orig.repId; rate = parseRate(String(orig.ratePercent)); kind = 'RETURN';
      } else {
        if (!input.repId) fail('repId', 'Choose the rep');
        const [rep] = await tx.$queryRaw<Rep[]>(Prisma.sql`
          SELECT id, "nameEn", "nameAr", "ratePercent", active FROM sales_reps WHERE id = ${String(input.repId)}::uuid AND "companyId" = ${companyId}::uuid`);
        if (!rep) fail('repId', 'That rep does not exist');
        if (!rep.active) fail('repId', 'That rep is not active', 'REP_INACTIVE');
        repId = rep.id; rate = parseRate(String(rep.ratePercent)); kind = 'SALE';
      }
      const amountP = (kind === 'RETURN' ? -1 : 1) * commissionPiasters(Math.abs(basisP), rate);
      const basis = (kind === 'RETURN' ? -1 : 1) * Math.abs(basisP);
      const id = randomUUID();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO commission_entries (id,"companyId","repId","salesInvoiceId",kind,"documentDate",basis,"ratePercent",amount,"createdBy")
        VALUES (${id}::uuid, ${companyId}::uuid, ${repId}::uuid, ${doc.id}::uuid, ${kind}, ${doc.invoiceDate}, ${money(basis)}::numeric, ${rateToPercent(rate)}, ${money(amountP)}::numeric, ${userId}::uuid)`);
      return { id, kind, amount: money(amountP), basis: money(basis), ratePercent: rateToPercent(rate) };
    });
    await this.audit.record({ companyId, userId, action: 'COMMISSION_ASSIGN', entity: 'sales_invoices', entityId: String(input.salesInvoiceId), after: result });
    return result;
  }

  /** An entry can be taken off only while it is unpaid. A sale cannot go while its credit note's entry stands. */
  async removeEntry(companyId: string, userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const [e] = await tx.$queryRaw<{ id: string; status: string; kind: string; salesInvoiceId: string }[]>(Prisma.sql`
        SELECT id, status, kind, "salesInvoiceId" FROM commission_entries WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
      if (!e) throw new NotFoundException({ code: 'COMMISSION_NOT_FOUND', message: 'That commission entry does not exist' });
      if (e.status === 'PAID') throw new ConflictException({ code: 'COMMISSION_PAID', message: 'This commission was already paid out and cannot be removed' });
      if (e.kind === 'SALE') {
        const [ret] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT ce.id FROM commission_entries ce JOIN sales_invoices cn ON cn.id = ce."salesInvoiceId" WHERE cn."originalInvoiceId" = ${e.salesInvoiceId}::uuid LIMIT 1`);
        if (ret) throw new ConflictException({ code: 'COMMISSION_HAS_RETURN', message: 'A return of this invoice carries commission. Remove that entry first.' });
      }
      await tx.$executeRaw(Prisma.sql`DELETE FROM commission_entries WHERE id = ${id}::uuid`);
    });
    await this.audit.record({ companyId, userId, action: 'COMMISSION_REMOVE', entity: 'commission_entries', entityId: id });
    return { removed: true };
  }

  async listEntries(companyId: string, query: { repId?: string; status?: string; from?: string; to?: string }) {
    const parts: Prisma.Sql[] = [Prisma.sql`WHERE ce."companyId" = ${companyId}::uuid`];
    if (query.repId) parts.push(Prisma.sql`AND ce."repId" = ${query.repId}::uuid`);
    if (query.status) {
      const st = query.status.toUpperCase();
      if (!['ACCRUED', 'PAID'].includes(st)) fail('status', 'Unknown status');
      parts.push(Prisma.sql`AND ce.status = ${st}`);
    }
    if (query.from) parts.push(Prisma.sql`AND ce."documentDate" >= ${dateOf('from', query.from)}::date`);
    if (query.to) parts.push(Prisma.sql`AND ce."documentDate" <= ${dateOf('to', query.to)}::date`);
    const rows = await this.prisma.$queryRaw<{ id: string; repId: string; repEn: string; repAr: string; salesInvoiceId: string; invoiceNumber: string; kind: string; documentDate: Date; basis: Prisma.Decimal; ratePercent: Prisma.Decimal; amount: Prisma.Decimal; status: string; payoutId: string | null }[]>(Prisma.sql`
      SELECT ce.id, ce."repId", r."nameEn" AS "repEn", r."nameAr" AS "repAr", ce."salesInvoiceId", inv."invoiceNumber", ce.kind, ce."documentDate",
             ce.basis, ce."ratePercent", ce.amount, ce.status, ce."payoutId"
        FROM commission_entries ce JOIN sales_reps r ON r.id = ce."repId" JOIN sales_invoices inv ON inv.id = ce."salesInvoiceId"
       ${Prisma.join(parts, ' ')} ORDER BY ce."documentDate" DESC, inv."invoiceNumber" LIMIT 1000`);
    const items = rows.map((r) => ({
      id: r.id, repId: r.repId, repEn: r.repEn, repAr: r.repAr, salesInvoiceId: r.salesInvoiceId, invoiceNumber: r.invoiceNumber, kind: r.kind,
      documentDate: r.documentDate.toISOString().slice(0, 10), basis: Number(r.basis), ratePercent: Number(r.ratePercent), amount: Number(r.amount), status: r.status, payoutId: r.payoutId,
    }));
    const sum = (st: string) => items.filter((i) => i.status === st).reduce((s, i) => s + Math.round(i.amount * 100), 0) / 100;
    return { items, totals: { accrued: sum('ACCRUED'), paid: sum('PAID') } };
  }

  /** Posted invoices and credit notes in the range that carry no commission entry yet. */
  async unassigned(companyId: string, query: { from?: string; to?: string }) {
    const parts: Prisma.Sql[] = [Prisma.sql`WHERE inv."companyId" = ${companyId}::uuid AND inv."deletedAt" IS NULL AND inv.status = 'POSTED' AND inv."documentType" IN ('INVOICE','CREDIT_NOTE') AND ce.id IS NULL`];
    if (query.from) parts.push(Prisma.sql`AND inv."invoiceDate" >= ${dateOf('from', query.from)}::date`);
    if (query.to) parts.push(Prisma.sql`AND inv."invoiceDate" <= ${dateOf('to', query.to)}::date`);
    const rows = await this.prisma.$queryRaw<{ id: string; invoiceNumber: string; invoiceDate: Date; documentType: string; totalAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; customerEn: string | null; customerAr: string | null }[]>(Prisma.sql`
      SELECT inv.id, inv."invoiceNumber", inv."invoiceDate", inv."documentType"::text AS "documentType", inv."totalAmount", inv."taxAmount", cu."nameEn" AS "customerEn", cu."nameAr" AS "customerAr"
        FROM sales_invoices inv LEFT JOIN commission_entries ce ON ce."salesInvoiceId" = inv.id LEFT JOIN customers cu ON cu.id = inv."customerId"
       ${Prisma.join(parts, ' ')} ORDER BY inv."invoiceDate" DESC, inv."invoiceNumber" LIMIT 1000`);
    return {
      items: rows.map((r) => ({
        id: r.id, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate.toISOString().slice(0, 10), documentType: r.documentType,
        basis: Number(money(invoiceBasis(r.totalAmount.toString(), r.taxAmount.toString()))), customerEn: r.customerEn, customerAr: r.customerAr,
      })),
    };
  }

  /** Pays every unpaid entry of one rep dated in the range, sales net of returns. The cash leaves through an ordinary payment voucher. */
  async payout(companyId: string, userId: string, input: { repId?: string; from?: string; to?: string; note?: string }) {
    if (!input.repId) fail('repId', 'Choose the rep');
    const from = dateOf('from', input.from);
    const to = dateOf('to', input.to);
    if (from > to) fail('from', 'The start date is after the end date');
    const note = input.note?.trim() ? input.note.trim().slice(0, 240) : null;
    const out = await this.prisma.$transaction(async (tx) => {
      const [rep] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM sales_reps WHERE id = ${String(input.repId)}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
      if (!rep) fail('repId', 'That rep does not exist');
      const rows = await tx.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>(Prisma.sql`
        SELECT id, amount FROM commission_entries
         WHERE "companyId" = ${companyId}::uuid AND "repId" = ${rep.id}::uuid AND status = 'ACCRUED' AND "documentDate" BETWEEN ${from}::date AND ${to}::date FOR UPDATE`);
      const total = rules('from', () => payoutTotal(rows.map((r) => ({ id: r.id, amountPiasters: Math.round(Number(r.amount) * 100) }))));
      const payoutId = randomUUID();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO commission_payouts (id,"companyId","repId","fromDate","toDate",amount,"entryCount",note,"paidBy")
        VALUES (${payoutId}::uuid, ${companyId}::uuid, ${rep.id}::uuid, ${from}::date, ${to}::date, ${money(total)}::numeric, ${rows.length}, ${note}, ${userId}::uuid)`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE commission_entries SET status = 'PAID', "payoutId" = ${payoutId}::uuid WHERE id IN (${Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`))})`);
      return { id: payoutId, amount: money(total), entries: rows.length };
    });
    await this.audit.record({ companyId, userId, action: 'COMMISSION_PAYOUT', entity: 'commission_payouts', entityId: out.id, after: { ...out, repId: input.repId, from, to } });
    return out;
  }

  async listPayouts(companyId: string, repId?: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; repId: string; repEn: string; repAr: string; fromDate: Date; toDate: Date; amount: Prisma.Decimal; entryCount: number; note: string | null; paidAt: Date }[]>(Prisma.sql`
      SELECT p.id, p."repId", r."nameEn" AS "repEn", r."nameAr" AS "repAr", p."fromDate", p."toDate", p.amount, p."entryCount", p.note, p."paidAt"
        FROM commission_payouts p JOIN sales_reps r ON r.id = p."repId"
       WHERE p."companyId" = ${companyId}::uuid ${repId ? Prisma.sql`AND p."repId" = ${repId}::uuid` : Prisma.empty}
       ORDER BY p."paidAt" DESC LIMIT 500`);
    return {
      items: rows.map((r) => ({
        id: r.id, repId: r.repId, repEn: r.repEn, repAr: r.repAr, from: r.fromDate.toISOString().slice(0, 10), to: r.toDate.toISOString().slice(0, 10),
        amount: Number(r.amount), entryCount: r.entryCount, note: r.note, paidAt: r.paidAt.toISOString(),
      })),
    };
  }
}
