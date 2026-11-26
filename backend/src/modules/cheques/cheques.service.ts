import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CashVouchersService } from '../cash/cash-vouchers.service';
import {
  ChequeAction,
  ChequeDirection,
  ChequeMoveError,
  ChequeStatus,
  CHEQUE_STATUSES,
  nextChequeStatus,
} from './cheque-rules';

const SCALE = 4;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ChequeAllocation {
  salesInvoiceId?: string;
  purchaseInvoiceId?: string;
  amount: string | number;
}

export interface CreateChequeInput {
  direction: string;
  chequeNumber: string;
  bankName: string;
  partyName?: string;
  customerId?: string;
  supplierId?: string;
  cashAccountId?: string;
  amount: string | number;
  issueDate: string;
  dueDate: string;
  notes?: string;
  allocations?: ChequeAllocation[];
}

type Row = {
  id: string; companyId: string; branchId: string; direction: ChequeDirection; chequeNumber: string; bankName: string;
  partyName: string | null; customerId: string | null; supplierId: string | null; cashAccountId: string | null;
  amount: Prisma.Decimal; currency: string; issueDate: Date; dueDate: Date; status: ChequeStatus;
  partyEn?: string | null; partyAr?: string | null;
  allocations: ChequeAllocation[] | null; voucherId: string | null; notes: string | null; createdAt: Date;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

function view(r: Row, today: string) {
  const due = day(r.dueDate);
  const open = r.status === 'HELD' || r.status === 'DEPOSITED';
  return {
    id: r.id,
    direction: r.direction,
    chequeNumber: r.chequeNumber,
    bankName: r.bankName,
    partyName: r.partyName,
    partyEn: r.partyEn ?? null,
    partyAr: r.partyAr ?? null,
    customerId: r.customerId,
    supplierId: r.supplierId,
    cashAccountId: r.cashAccountId,
    amount: new Prisma.Decimal(r.amount).toFixed(SCALE),
    currency: r.currency,
    issueDate: day(r.issueDate),
    dueDate: due,
    status: r.status,
    allocations: r.allocations ?? [],
    voucherId: r.voucherId,
    notes: r.notes,
    // Open and past its due date: the list can flag it.
    overdue: open && due < today,
  };
}

/**
 * Cheques received from customers and issued to suppliers.
 *
 * A cheque is registered and followed, but the books move only when the bank
 * confirms it: collecting a received cheque posts a normal receipt on the bank
 * account (with the invoice allocations given at registration), and clearing an
 * issued cheque posts a normal payment. Both reuse the cash voucher engine, so
 * balances, allocations, period locks and permissions all behave the same way.
 */
@Injectable()
export class ChequesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vouchers: CashVouchersService,
    private readonly audit: AuditService,
  ) {}

  private text(value: unknown, field: string, max: number, required = true): string | null {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) {
      if (required) throw new BadRequestException({ code: 'VALIDATION', message: `${field} is required`, field });
      return null;
    }
    if (v.length > max) throw new BadRequestException({ code: 'VALIDATION', message: `${field} is too long`, field });
    return v;
  }

  private date(value: unknown, field: string): string {
    const v = String(value ?? '');
    if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
      throw new BadRequestException({ code: 'VALIDATION', message: `${field} must be a real date (YYYY-MM-DD)`, field });
    }
    return v;
  }

  async create(companyId: string, branchId: string | null, userId: string, input: CreateChequeInput) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const direction = String(input.direction ?? '').toUpperCase() as ChequeDirection;
    if (direction !== 'RECEIVED' && direction !== 'ISSUED') {
      throw new BadRequestException({ code: 'VALIDATION', message: 'direction must be RECEIVED or ISSUED', field: 'direction' });
    }
    const chequeNumber = this.text(input.chequeNumber, 'chequeNumber', 64)!;
    const bankName = this.text(input.bankName, 'bankName', 160)!;
    const partyName = this.text(input.partyName, 'partyName', 200, false);
    const notes = this.text(input.notes, 'notes', 2000, false);
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(input.amount as never);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION', message: 'amount must be a number', field: 'amount' });
    }
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0) || amount.decimalPlaces() > SCALE) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'amount must be greater than zero', field: 'amount' });
    }
    const issueDate = this.date(input.issueDate, 'issueDate');
    const dueDate = this.date(input.dueDate, 'dueDate');
    if (dueDate < issueDate) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'dueDate must not be before issueDate', field: 'dueDate' });
    }
    if (direction === 'RECEIVED') {
      if (!input.customerId) throw new BadRequestException({ code: 'VALIDATION', message: 'A received cheque needs a customer', field: 'customerId' });
      if (input.supplierId) throw new BadRequestException({ code: 'VALIDATION', message: 'A received cheque has no supplier', field: 'supplierId' });
      const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId, deletedAt: null }, select: { id: true } });
      if (!c) throw new BadRequestException({ code: 'VALIDATION', message: 'Customer not found', field: 'customerId' });
    } else {
      if (!input.supplierId) throw new BadRequestException({ code: 'VALIDATION', message: 'An issued cheque needs a supplier', field: 'supplierId' });
      if (input.customerId) throw new BadRequestException({ code: 'VALIDATION', message: 'An issued cheque has no customer', field: 'customerId' });
      const s = await this.prisma.supplier.findFirst({ where: { id: input.supplierId, companyId, deletedAt: null }, select: { id: true } });
      if (!s) throw new BadRequestException({ code: 'VALIDATION', message: 'Supplier not found', field: 'supplierId' });
    }
    if (input.cashAccountId) {
      const a = await this.prisma.cashAccount.findFirst({ where: { id: input.cashAccountId, companyId }, select: { id: true } });
      if (!a) throw new BadRequestException({ code: 'VALIDATION', message: 'Bank account not found', field: 'cashAccountId' });
    } else if (direction === 'ISSUED') {
      throw new BadRequestException({ code: 'VALIDATION', message: 'An issued cheque needs the bank account it is drawn on', field: 'cashAccountId' });
    }
    const allocations = input.allocations ?? [];
    let allocated = new Prisma.Decimal(0);
    for (const a of allocations) {
      let n: Prisma.Decimal;
      try { n = new Prisma.Decimal(a.amount as never); } catch { n = new Prisma.Decimal(0); }
      if (n.lessThanOrEqualTo(0)) throw new BadRequestException({ code: 'VALIDATION', message: 'Each allocation must be greater than zero', field: 'allocations' });
      if (direction === 'RECEIVED' ? !a.salesInvoiceId || a.purchaseInvoiceId : !a.purchaseInvoiceId || a.salesInvoiceId) {
        throw new BadRequestException({ code: 'VALIDATION', message: 'Allocations must name the matching kind of invoice', field: 'allocations' });
      }
      allocated = allocated.plus(n);
    }
    if (allocated.greaterThan(amount)) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'The allocations are more than the cheque amount', field: 'allocations' });
    }

    const id = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO cheques (id,"companyId","branchId",direction,"chequeNumber","bankName","partyName","customerId","supplierId","cashAccountId",
                               amount,"issueDate","dueDate",allocations,notes,"createdBy")
          VALUES (${id}::uuid, ${companyId}::uuid, ${branchId}::uuid, ${direction}, ${chequeNumber}, ${bankName}, ${partyName},
                  ${input.customerId ?? null}::uuid, ${input.supplierId ?? null}::uuid, ${input.cashAccountId ?? null}::uuid,
                  ${amount}, ${issueDate}::date, ${dueDate}::date, ${allocations.length ? JSON.stringify(allocations) : null}::jsonb,
                  ${notes}, ${userId}::uuid)`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO cheque_events (id,"chequeId",action,"toStatus","userId") VALUES (${randomUUID()}::uuid, ${id}::uuid, 'register', 'HELD', ${userId}::uuid)`);
      });
    } catch (error) {
      if (String((error as { message?: string }).message ?? error).includes('cheques_number_unique')) {
        throw new ConflictException({ code: 'CHEQUE_DUPLICATE', message: 'That cheque number is already registered for this bank', field: 'chequeNumber' });
      }
      throw error;
    }
    await this.audit.record({ companyId, userId, action: 'CHEQUE_REGISTER', entity: 'cheques', entityId: id, after: { direction, chequeNumber, bankName, amount: amount.toFixed(SCALE) } });
    return this.findOne(companyId, id);
  }

  private async rows(companyId: string, where: Prisma.Sql): Promise<Row[]> {
    return this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT q.*, COALESCE(cu."nameEn", su."nameEn") AS "partyEn", COALESCE(cu."nameAr", su."nameAr") AS "partyAr"
        FROM cheques q
        LEFT JOIN customers cu ON cu.id = q."customerId"
        LEFT JOIN suppliers su ON su.id = q."supplierId"
       WHERE q."companyId" = ${companyId}::uuid ${where} ORDER BY q."dueDate" ASC, q."chequeNumber" ASC`);
  }

  async findOne(companyId: string, id: string) {
    const [row] = await this.rows(companyId, Prisma.sql`AND q.id = ${id}::uuid`);
    if (!row) throw new NotFoundException('Cheque not found');
    const events = await this.prisma.$queryRaw<Array<{ action: string; fromStatus: string | null; toStatus: string; note: string | null; voucherId: string | null; at: Date }>>(
      Prisma.sql`SELECT action,"fromStatus","toStatus",note,"voucherId","at" FROM cheque_events WHERE "chequeId" = ${id}::uuid ORDER BY "at" ASC`);
    return { ...view(row, new Date().toISOString().slice(0, 10)), events: events.map((e) => ({ ...e, at: e.at.toISOString() })) };
  }

  async list(companyId: string, query: { direction?: string; status?: string; dueBefore?: string; branchScope?: string[] | null }) {
    const parts: Prisma.Sql[] = [];
    if (query.direction) {
      const d = query.direction.toUpperCase();
      if (d !== 'RECEIVED' && d !== 'ISSUED') throw new BadRequestException('direction must be RECEIVED or ISSUED');
      parts.push(Prisma.sql`AND q.direction = ${d}`);
    }
    if (query.status) {
      const s = query.status.toUpperCase();
      if (s === 'OPEN') parts.push(Prisma.sql`AND q.status IN ('HELD','DEPOSITED')`);
      else if (CHEQUE_STATUSES.includes(s as ChequeStatus)) parts.push(Prisma.sql`AND q.status = ${s}`);
      else throw new BadRequestException('status must be OPEN or one of ' + CHEQUE_STATUSES.join(', '));
    }
    if (query.dueBefore) parts.push(Prisma.sql`AND q."dueDate" <= ${this.date(query.dueBefore, 'dueBefore')}::date`);
    if (query.branchScope) parts.push(Prisma.sql`AND q."branchId" = ANY(${query.branchScope}::uuid[])`);
    const rows = await this.rows(companyId, parts.length ? Prisma.join(parts, ' ') : Prisma.empty);
    const today = new Date().toISOString().slice(0, 10);
    const data = rows.map((r) => view(r, today));
    const sum = (f: (r: ReturnType<typeof view>) => boolean) =>
      data.filter(f).reduce((a, r) => a.plus(r.amount), new Prisma.Decimal(0)).toFixed(SCALE);
    return {
      items: data,
      rows: data,
      totals: {
        count: data.length,
        open: sum((r) => r.status === 'HELD' || r.status === 'DEPOSITED'),
        overdue: sum((r) => r.overdue),
      },
    };
  }

  /** One move in the life cycle. Collect books the money through a normal posted voucher. */
  async act(
    companyId: string,
    userId: string,
    branchId: string | null,
    id: string,
    action: ChequeAction,
    input: { note?: string; date?: string; cashAccountId?: string } = {},
    options: { discloseBalance?: boolean } = {},
  ) {
    const [current] = await this.rows(companyId, Prisma.sql`AND q.id = ${id}::uuid`);
    if (!current) throw new NotFoundException('Cheque not found');
    let target: ChequeStatus;
    try {
      target = nextChequeStatus(current.direction, current.status, action);
    } catch (error) {
      if (error instanceof ChequeMoveError) throw new ConflictException({ code: 'CHEQUE_STATE', message: error.message });
      throw error;
    }
    const note = this.text(input.note, 'note', 500, false);
    if ((action === 'bounce' || action === 'cancel') && !note) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'A short reason is required', field: 'note' });
    }
    const bankId = input.cashAccountId ?? current.cashAccountId;
    if (action === 'collect' && !bankId) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'Choose the bank account the cheque is collected into', field: 'cashAccountId' });
    }
    const when = input.date ? this.date(input.date, 'date') : new Date().toISOString().slice(0, 10);

    // Claim the move first, so two people pressing the button cannot both win.
    const claimed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE cheques SET status = ${target}, "updatedAt" = now(), "cashAccountId" = COALESCE(${bankId}::uuid, "cashAccountId")
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND status = ${current.status}`);
    if (claimed !== 1) throw new ConflictException({ code: 'CHEQUE_STATE', message: 'The cheque was changed by someone else. Reload and try again.' });

    let voucherId: string | null = null;
    if (action === 'collect') {
      try {
        const created: { id: string } = await this.vouchers.create(
          companyId, branchId ?? current.branchId, userId,
          {
            kind: current.direction === 'RECEIVED' ? 'RECEIPT' : 'PAYMENT',
            cashAccountId: bankId!,
            voucherDate: when,
            amount: new Prisma.Decimal(current.amount).toFixed(SCALE),
            ...(current.customerId ? { customerId: current.customerId } : {}),
            ...(current.supplierId ? { supplierId: current.supplierId } : {}),
            description: `Cheque ${current.chequeNumber} - ${current.bankName}`,
            reference: `CHQ ${current.chequeNumber}`,
            allocations: current.allocations ?? [],
          },
          options,
        ) as never;
        voucherId = created.id;
        await this.vouchers.post(companyId, userId, voucherId, options);
      } catch (error) {
        // Nothing was booked: put the cheque back and drop the unposted draft.
        await this.prisma.$executeRaw(Prisma.sql`UPDATE cheques SET status = ${current.status}, "updatedAt" = now() WHERE id = ${id}::uuid AND status = ${target}`);
        if (voucherId) {
          await this.prisma.$executeRaw(Prisma.sql`UPDATE cash_vouchers SET "deletedAt" = now() WHERE id = ${voucherId}::uuid AND status = 'DRAFT'`);
        }
        throw error;
      }
      await this.prisma.$executeRaw(Prisma.sql`UPDATE cheques SET "voucherId" = ${voucherId}::uuid WHERE id = ${id}::uuid`);
    }
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO cheque_events (id,"chequeId",action,"fromStatus","toStatus",note,"voucherId","userId")
      VALUES (${randomUUID()}::uuid, ${id}::uuid, ${action}, ${current.status}, ${target}, ${note}, ${voucherId}::uuid, ${userId}::uuid)`);
    await this.audit.record({
      companyId, userId, action: `CHEQUE_${action.toUpperCase()}`, entity: 'cheques', entityId: id,
      after: { from: current.status, to: target, voucherId, note },
    });
    return this.findOne(companyId, id);
  }
}
