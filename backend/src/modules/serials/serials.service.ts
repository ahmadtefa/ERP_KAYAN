import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  nextSerialStatus,
  parseSerialList,
  parseWarrantyMonths,
  SerialAction,
  SerialError,
  SerialStatus,
  warrantyDaysLeft,
  warrantyEndDate,
  warrantyState,
} from './serial-rules';

type Row = {
  id: string; itemId: string; serialNumber: string; warehouseId: string | null; status: SerialStatus; warrantyMonths: number;
  salesInvoiceId: string | null; customerId: string | null; soldOn: Date | null; warrantyEndsOn: Date | null; reference: string | null;
  itemCode?: string; itemEn?: string; itemAr?: string; invoiceNumber?: string | null; customerEn?: string | null; customerAr?: string | null;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function fail(field: string, message: string, code = 'VALIDATION'): never {
  throw new BadRequestException({ code, message, field });
}

/** Wraps a rules error as a field error. */
function rules<T>(field: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SerialError) fail(field, e.message);
    throw e;
  }
}

@Injectable()
export class SerialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(r: Row, today: string) {
    const ends = day(r.warrantyEndsOn);
    return {
      id: r.id, itemId: r.itemId, itemCode: r.itemCode ?? null, itemEn: r.itemEn ?? null, itemAr: r.itemAr ?? null,
      serialNumber: r.serialNumber, warehouseId: r.warehouseId, status: r.status, warrantyMonths: r.warrantyMonths,
      salesInvoiceId: r.salesInvoiceId, invoiceNumber: r.invoiceNumber ?? null,
      customerId: r.customerId, customerEn: r.customerEn ?? null, customerAr: r.customerAr ?? null,
      soldOn: day(r.soldOn), warrantyEndsOn: ends, reference: r.reference,
      warranty: warrantyState(r.status, ends, today), warrantyDaysLeft: r.status === 'SOLD' ? warrantyDaysLeft(ends, today) : null,
    };
  }

  private select(extra: Prisma.Sql = Prisma.empty, limit = 500) {
    return Prisma.sql`
      SELECT s.*, i.code AS "itemCode", i."nameEn" AS "itemEn", i."nameAr" AS "itemAr",
             inv."invoiceNumber", cu."nameEn" AS "customerEn", cu."nameAr" AS "customerAr"
        FROM serial_units s
        JOIN items i ON i.id = s."itemId"
        LEFT JOIN sales_invoices inv ON inv.id = s."salesInvoiceId"
        LEFT JOIN customers cu ON cu.id = s."customerId"
       ${extra}
       ORDER BY s."createdAt" DESC, s."serialNumber" LIMIT ${limit}`;
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }

  async list(companyId: string, query: { itemId?: string; status?: string; q?: string; warrantyEndingInDays?: string }) {
    const parts: Prisma.Sql[] = [Prisma.sql`WHERE s."companyId" = ${companyId}::uuid`];
    if (query.itemId) parts.push(Prisma.sql`AND s."itemId" = ${query.itemId}::uuid`);
    if (query.status) {
      const st = query.status.toUpperCase();
      if (!['IN_STOCK', 'SOLD', 'RETURNED', 'SCRAPPED'].includes(st)) fail('status', 'Unknown status');
      parts.push(Prisma.sql`AND s.status = ${st}`);
    }
    if (query.q?.trim()) parts.push(Prisma.sql`AND s."serialNumber" ILIKE ${'%' + query.q.trim().replace(/[%_\\]/g, (c) => '\\' + c) + '%'}`);
    if (query.warrantyEndingInDays !== undefined && query.warrantyEndingInDays !== '') {
      const n = Number(query.warrantyEndingInDays);
      if (!Number.isInteger(n) || n < 0 || n > 3650) fail('warrantyEndingInDays', 'Days must be a whole number from 0 to 3650');
      parts.push(Prisma.sql`AND s.status = 'SOLD' AND s."warrantyEndsOn" BETWEEN CURRENT_DATE AND CURRENT_DATE + ${n}::int`);
    }
    const rows = await this.prisma.$queryRaw<Row[]>(this.select(Prisma.join(parts, ' ')));
    const today = this.today();
    const items = rows.map((r) => this.view(r, today));
    return { items, totals: { count: items.length } };
  }

  /** Every unit with this serial number (the same number can exist for different items), with its history. */
  async lookup(companyId: string, serial: string) {
    const s = String(serial ?? '').trim();
    if (!s) fail('serial', 'Enter a serial number');
    const rows = await this.prisma.$queryRaw<Row[]>(this.select(Prisma.sql`WHERE s."companyId" = ${companyId}::uuid AND lower(s."serialNumber") = lower(${s})`));
    if (rows.length === 0) throw new NotFoundException({ code: 'SERIAL_NOT_FOUND', message: 'No unit is registered with that serial number' });
    const today = this.today();
    const out = [];
    for (const r of rows) {
      const events = await this.prisma.$queryRaw<{ action: string; fromStatus: string | null; toStatus: string; note: string | null; at: Date; invoiceNumber: string | null }[]>(Prisma.sql`
        SELECT e.action, e."fromStatus", e."toStatus", e.note, e."at", inv."invoiceNumber"
          FROM serial_events e LEFT JOIN sales_invoices inv ON inv.id = e."salesInvoiceId"
         WHERE e."serialId" = ${r.id}::uuid ORDER BY e."at", e.id`);
      out.push({
        ...this.view(r, today),
        events: events.map((e) => ({ action: e.action, from: e.fromStatus, to: e.toStatus, note: e.note, at: e.at.toISOString(), invoiceNumber: e.invoiceNumber })),
      });
    }
    return { items: out };
  }

  private async requireItem(companyId: string, itemId: unknown) {
    if (!itemId) fail('itemId', 'Choose the item');
    const [item] = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM items WHERE id = ${String(itemId)}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
    if (!item) fail('itemId', 'That item does not exist');
    return item.id;
  }

  /** Puts new units on the shelf. All or none: one repeated serial refuses the whole list. */
  async register(
    companyId: string,
    userId: string,
    input: { itemId?: string; warehouseId?: string; serials?: unknown; warrantyMonths?: unknown; reference?: string },
  ) {
    const itemId = await this.requireItem(companyId, input.itemId);
    const serials = rules('serials', () => parseSerialList(input.serials));
    const months = rules('warrantyMonths', () => parseWarrantyMonths(input.warrantyMonths));
    const reference = input.reference?.trim() ? input.reference.trim().slice(0, 120) : null;
    let warehouseId: string | null = null;
    if (input.warehouseId) {
      const [w] = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM warehouses WHERE id = ${input.warehouseId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
      if (!w) fail('warehouseId', 'That warehouse does not exist');
      warehouseId = w.id;
    }
    const existing = await this.prisma.$queryRaw<{ serialNumber: string }[]>(Prisma.sql`
      SELECT "serialNumber" FROM serial_units
       WHERE "companyId" = ${companyId}::uuid AND "itemId" = ${itemId}::uuid AND lower("serialNumber") IN (${Prisma.join(serials.map((s) => Prisma.sql`lower(${s})`))})`);
    if (existing.length) {
      throw new ConflictException({
        code: 'SERIAL_DUPLICATE',
        message: `Already registered for this item: ${existing.slice(0, 5).map((e) => e.serialNumber).join(', ')}${existing.length > 5 ? ` and ${existing.length - 5} more` : ''}. Nothing was saved.`,
        field: 'serials',
        errors: { duplicates: existing.map((e) => e.serialNumber) },
      });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const serial of serials) {
          const id = randomUUID();
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO serial_units (id,"companyId","itemId","serialNumber","warehouseId","warrantyMonths",reference,"createdBy")
            VALUES (${id}::uuid, ${companyId}::uuid, ${itemId}::uuid, ${serial}, ${warehouseId}::uuid, ${months}, ${reference}, ${userId}::uuid)`);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO serial_events (id,"serialId",action,"fromStatus","toStatus","userId")
            VALUES (${randomUUID()}::uuid, ${id}::uuid, 'register', NULL, 'IN_STOCK', ${userId}::uuid)`);
        }
      });
    } catch (error) {
      if (String((error as Error).message).includes('serial_units_unique')) {
        throw new ConflictException({ code: 'SERIAL_DUPLICATE', message: 'One of these serial numbers was just registered by someone else. Nothing was saved.', field: 'serials' });
      }
      throw error;
    }
    await this.audit.record({ companyId, userId, action: 'SERIAL_REGISTER', entity: 'serial_units', entityId: itemId, after: { count: serials.length, warrantyMonths: months } });
    return { registered: serials.length };
  }

  /** Assigns units to a posted sales invoice. This starts each unit's warranty from the invoice date. */
  async sell(
    companyId: string,
    userId: string,
    input: { salesInvoiceId?: string; itemId?: string; serials?: unknown; warrantyMonths?: unknown },
  ) {
    const itemId = await this.requireItem(companyId, input.itemId);
    if (!input.salesInvoiceId) fail('salesInvoiceId', 'Choose the sales invoice');
    const serials = rules('serials', () => parseSerialList(input.serials));
    const override = input.warrantyMonths === undefined || input.warrantyMonths === '' ? null : rules('warrantyMonths', () => parseWarrantyMonths(input.warrantyMonths));
    const [inv] = await this.prisma.$queryRaw<{ id: string; status: string; invoiceDate: Date; customerId: string | null; invoiceNumber: string; documentType: string }[]>(Prisma.sql`
      SELECT id, status::text AS status, "invoiceDate", "customerId", "invoiceNumber", "documentType"::text AS "documentType" FROM sales_invoices
       WHERE id = ${String(input.salesInvoiceId)}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
    if (!inv) fail('salesInvoiceId', 'That sales invoice does not exist');
    if (inv.status !== 'POSTED' || inv.documentType !== 'INVOICE') fail('salesInvoiceId', 'Serial numbers are assigned to a posted sales invoice');
    const [{ qty }] = await this.prisma.$queryRaw<{ qty: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(quantity), 0) AS qty FROM sales_invoice_lines
       WHERE "invoiceId" = ${inv.id}::uuid AND "itemId" = ${itemId}::uuid AND "isAdditionalCharge" = false`);
    const allowed = Math.floor(Number(qty ?? 0));
    if (allowed <= 0) fail('itemId', `Invoice ${inv.invoiceNumber} has no line for that item`);
    const soldOn = inv.invoiceDate.toISOString().slice(0, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      // One assignment per invoice at a time, so two people cannot each take the last slot.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_invoices WHERE id = ${inv.id}::uuid FOR UPDATE`);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT * FROM serial_units
         WHERE "companyId" = ${companyId}::uuid AND "itemId" = ${itemId}::uuid AND lower("serialNumber") IN (${Prisma.join(serials.map((s) => Prisma.sql`lower(${s})`))})
         ORDER BY id FOR UPDATE`);
      const found = new Set(rows.map((r) => r.serialNumber.toLowerCase()));
      const missing = serials.filter((s) => !found.has(s.toLowerCase()));
      if (missing.length) {
        throw new BadRequestException({ code: 'SERIAL_NOT_FOUND', message: `Not registered for this item: ${missing.slice(0, 5).join(', ')}. Register them first.`, field: 'serials' });
      }
      const [{ already }] = await tx.$queryRaw<{ already: number }[]>(Prisma.sql`
        SELECT count(*)::int AS already FROM serial_units WHERE "salesInvoiceId" = ${inv.id}::uuid AND "itemId" = ${itemId}::uuid AND status = 'SOLD'`);
      if (already + rows.length > allowed) {
        throw new BadRequestException({
          code: 'SERIAL_TOO_MANY',
          message: `Invoice ${inv.invoiceNumber} sold ${allowed} of this item and ${already} serial number(s) are already assigned. You can assign ${Math.max(allowed - already, 0)} more.`,
          field: 'serials',
        });
      }
      for (const r of rows) {
        try {
          nextSerialStatus(r.status, 'sell');
        } catch (e) {
          throw new ConflictException({ code: 'SERIAL_STATE', message: `${r.serialNumber}: ${(e as Error).message}`, field: 'serials' });
        }
        const months = override ?? r.warrantyMonths;
        const ends = warrantyEndDate(soldOn, months);
        await tx.$executeRaw(Prisma.sql`
          UPDATE serial_units SET status = 'SOLD', "salesInvoiceId" = ${inv.id}::uuid, "customerId" = ${inv.customerId}::uuid,
                 "soldOn" = ${soldOn}::date, "warrantyMonths" = ${months}, "warrantyEndsOn" = ${ends}::date, "updatedAt" = now()
           WHERE id = ${r.id}::uuid`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO serial_events (id,"serialId",action,"fromStatus","toStatus","salesInvoiceId","userId")
          VALUES (${randomUUID()}::uuid, ${r.id}::uuid, 'sell', ${r.status}, 'SOLD', ${inv.id}::uuid, ${userId}::uuid)`);
      }
      return rows.length;
    });
    await this.audit.record({ companyId, userId, action: 'SERIAL_SELL', entity: 'sales_invoices', entityId: inv.id, after: { itemId, count: result } });
    return { sold: result, invoiceNumber: inv.invoiceNumber, soldOn };
  }

  /** A customer brings a unit back, or a unit on the shelf is written off. */
  async act(companyId: string, userId: string, id: string, action: Exclude<SerialAction, 'sell'>, input: { note?: string }) {
    const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
    if (!note) fail('note', 'A short reason is required');
    const updated = await this.prisma.$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM serial_units WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
      if (!r) throw new NotFoundException({ code: 'SERIAL_NUMBER_NOT_FOUND', message: 'Serial number not found' });
      let to: SerialStatus;
      try {
        to = nextSerialStatus(r.status, action);
      } catch (e) {
        throw new ConflictException({ code: 'SERIAL_STATE', message: (e as Error).message });
      }
      if (action === 'return') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE serial_units SET status = ${to}, "salesInvoiceId" = NULL, "customerId" = NULL, "soldOn" = NULL, "warrantyEndsOn" = NULL, "updatedAt" = now()
           WHERE id = ${id}::uuid`);
      } else {
        await tx.$executeRaw(Prisma.sql`UPDATE serial_units SET status = ${to}, "updatedAt" = now() WHERE id = ${id}::uuid`);
      }
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO serial_events (id,"serialId",action,"fromStatus","toStatus","salesInvoiceId",note,"userId")
        VALUES (${randomUUID()}::uuid, ${id}::uuid, ${action}, ${r.status}, ${to}, ${r.salesInvoiceId}::uuid, ${note}, ${userId}::uuid)`);
      return r;
    });
    await this.audit.record({ companyId, userId, action: `SERIAL_${action.toUpperCase()}`, entity: 'serial_units', entityId: id, after: { note } });
    const [row] = await this.prisma.$queryRaw<Row[]>(this.select(Prisma.sql`WHERE s.id = ${updated.id}::uuid`, 1));
    return this.view(row, this.today());
  }

  /**
   * Sold lines of serial-tracked items with fewer serial numbers assigned than units sold.
   * An item counts as tracked once any serial is registered for it. Nothing here blocks a sale.
   */
  async unassigned(companyId: string, query: { from?: string; to?: string }) {
    const from = query.from ?? '1900-01-01';
    const to = query.to ?? '2999-12-31';
    for (const [f, v] of [['from', from], ['to', to]] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(f, `${f} must be a date (YYYY-MM-DD)`);
    }
    const rows = await this.prisma.$queryRaw<{
      invoiceId: string; invoiceNumber: string; invoiceDate: Date; itemId: string; itemCode: string; itemEn: string; itemAr: string;
      sold: Prisma.Decimal; assigned: number;
    }[]>(Prisma.sql`
      WITH tracked AS (SELECT DISTINCT "itemId" FROM serial_units WHERE "companyId" = ${companyId}::uuid),
      sold AS (
        SELECT l."invoiceId", l."itemId", SUM(l.quantity) AS sold
          FROM sales_invoice_lines l
          JOIN sales_invoices inv ON inv.id = l."invoiceId"
         WHERE inv."companyId" = ${companyId}::uuid AND inv.status = 'POSTED' AND inv."documentType" = 'INVOICE' AND inv."deletedAt" IS NULL
           AND l."isAdditionalCharge" = false AND l."itemId" IN (SELECT "itemId" FROM tracked)
           AND inv."invoiceDate" BETWEEN ${from}::date AND ${to}::date
         GROUP BY l."invoiceId", l."itemId")
      SELECT s."invoiceId", inv."invoiceNumber", inv."invoiceDate", s."itemId", i.code AS "itemCode", i."nameEn" AS "itemEn", i."nameAr" AS "itemAr",
             s.sold, (SELECT count(*)::int FROM serial_units u WHERE u."salesInvoiceId" = s."invoiceId" AND u."itemId" = s."itemId" AND u.status = 'SOLD') AS assigned
        FROM sold s JOIN sales_invoices inv ON inv.id = s."invoiceId" JOIN items i ON i.id = s."itemId"
       WHERE floor(s.sold) > (SELECT count(*) FROM serial_units u WHERE u."salesInvoiceId" = s."invoiceId" AND u."itemId" = s."itemId" AND u.status = 'SOLD')
       ORDER BY inv."invoiceDate", inv."invoiceNumber" LIMIT 1000`);
    const items = rows.map((r) => ({
      invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate.toISOString().slice(0, 10),
      itemId: r.itemId, itemCode: r.itemCode, itemEn: r.itemEn, itemAr: r.itemAr,
      sold: Math.floor(Number(r.sold)), assigned: r.assigned, missing: Math.floor(Number(r.sold)) - r.assigned,
    }));
    return { items, totals: { lines: items.length, missing: items.reduce((a, i) => a + i.missing, 0) } };
  }
}
