import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ACCOUNT_CODES } from '../accounting/account-map.service';
import { FixedAssetsService } from '../fixed-assets/fixed-assets.service';
import { PartyReconciliationService } from './party-reconciliation.service';

const MONEY_SCALE = 4;
const money = (value: Prisma.Decimal) => value.toFixed(MONEY_SCALE);
const isZero = (value: string) => new Prisma.Decimal(value).isZero();

type SectionStatus = 'matched' | 'difference' | 'incomplete';

interface Section {
  key: 'receivables' | 'payables' | 'inventory' | 'fixedAssets';
  status: SectionStatus;
  /// True when a nonzero difference is entirely accounted for by known
  /// items (advances held, postings without a subledger document). A
  /// difference can be real and explained, or real and unexplained —
  /// those are different conversations with the accountant.
  fullyExplained: boolean;
  subledger: string | null;
  control: string | null;
  difference: string | null;
  reason: string | null;
  details: Record<string, unknown>;
}

const incomplete = (
  key: Section['key'],
  error: unknown,
): Section => ({
  key,
  status: 'incomplete',
  fullyExplained: false,
  subledger: null,
  control: null,
  difference: null,
  reason:
    error instanceof HttpException
      ? String(
          (error.getResponse() as { message?: string })?.message ??
            error.message,
        )
      : 'This reconciliation could not be computed.',
  details: {},
});

/**
 * The reconciliation centre: every subledger the system keeps, held up
 * against the general-ledger account that is supposed to equal it, on
 * one page, as of one date.
 *
 * It composes the existing reconciliations rather than re-deriving
 * them — the party reconciliation, the fixed-asset register summary —
 * and reads inventory the same way the valuation report does (stock
 * balances against the inventory account). Each section stands or
 * falls on its own: a missing control account makes that section
 * "incomplete" with the reason, never a failed page and never a
 * silent zero dressed up as agreement. Nothing here adjusts a
 * balance; finding and explaining differences is the whole job.
 */
@Injectable()
export class ReconciliationCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parties: PartyReconciliationService,
    private readonly fixedAssets: FixedAssetsService,
  ) {}

  async center(companyId: string, query: { asOf?: string }) {
    const asOf = query.asOf
      ? query.asOf.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const [receivables, payables, inventory, fixedAssets] = await Promise.all([
      this.partySection(companyId, 'receivables', asOf),
      this.partySection(companyId, 'payables', asOf),
      this.inventorySection(companyId, asOf),
      this.fixedAssetsSection(companyId),
    ]);

    return { asOf, sections: [receivables, payables, inventory, fixedAssets] };
  }

  private async partySection(
    companyId: string,
    key: 'receivables' | 'payables',
    asOf: string,
  ): Promise<Section> {
    try {
      const rec =
        key === 'receivables'
          ? await this.parties.receivables(companyId, { asOf })
          : await this.parties.payables(companyId, { asOf });
      const difference = rec.difference;
      const unexplained = rec.unexplained;
      return {
        key,
        status: isZero(difference) && isZero(unexplained) ? 'matched' : 'difference',
        fullyExplained: isZero(unexplained),
        subledger: rec.subledger.total,
        control: rec.controlBalance,
        difference,
        reason: null,
        details: {
          controlCode: rec.controlAccount.code,
          invoiced: rec.subledger.invoiced,
          notes: rec.subledger.notes,
          paidApplied: rec.subledger.paidApplied,
          advances: rec.advances,
          otherPostings: rec.otherPostings.length,
          otherPostingsTotal: rec.otherPostingsTotal,
          unexplained,
        },
      };
    } catch (error) {
      return incomplete(key, error);
    }
  }

  private async inventorySection(
    companyId: string,
    asOf: string,
  ): Promise<Section> {
    try {
      const account = await this.prisma.account.findFirst({
        where: { companyId, code: ACCOUNT_CODES.inventory, deletedAt: null },
        select: { id: true, code: true },
      });
      if (!account) {
        return {
          ...incomplete(
            'inventory',
            new Error('missing'),
          ),
          reason: `Inventory account ${ACCOUNT_CODES.inventory} does not exist in this company's chart`,
        };
      }
      const asOfDate = new Date(`${asOf}T23:59:59.999Z`);
      const [stock, ledgerRows] = await Promise.all([
        this.prisma.stockBalance.aggregate({
          where: { companyId },
          _sum: { value: true },
        }),
        this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
          SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l."journalEntryId"
           WHERE e."companyId" = ${companyId}::uuid
             AND e.status IN ('POSTED', 'REVERSED')
             AND e."entryDate" <= ${asOfDate}::timestamp
             AND l."accountId" = ${account.id}::uuid
        `),
      ]);
      const stockValue = new Prisma.Decimal(stock._sum.value ?? 0);
      const ledgerValue = new Prisma.Decimal(ledgerRows[0]?.net ?? 0);
      const difference = stockValue.minus(ledgerValue);
      return {
        key: 'inventory',
        status: difference.isZero() ? 'matched' : 'difference',
        // Stock has no "advances" story: a difference here is never
        // explained away inside this report; it is a posting to find.
        fullyExplained: difference.isZero(),
        subledger: money(stockValue),
        control: money(ledgerValue),
        difference: money(difference),
        reason: null,
        details: { controlCode: account.code },
      };
    } catch (error) {
      return incomplete('inventory', error);
    }
  }

  private async fixedAssetsSection(companyId: string): Promise<Section> {
    try {
      const summary = await this.fixedAssets.summary(companyId);
      const accountRows = [
        ...summary.assetAccounts,
        ...summary.accumulatedAccounts,
      ];
      const worst = accountRows.reduce(
        (max, row) => {
          const d = new Prisma.Decimal(row.difference).abs();
          return d.greaterThan(max) ? d : max;
        },
        new Prisma.Decimal(0),
      );
      const ledgerBookValue = accountRows
        .filter((_, i) => i < summary.assetAccounts.length)
        .reduce((s, r) => s.plus(r.ledger), new Prisma.Decimal(0))
        .minus(
          summary.accumulatedAccounts.reduce(
            (s, r) => s.plus(r.ledger),
            new Prisma.Decimal(0),
          ),
        );
      const registerBookValue = new Prisma.Decimal(summary.totals.bookValue);
      return {
        key: 'fixedAssets',
        status: worst.isZero() ? 'matched' : 'difference',
        fullyExplained: worst.isZero(),
        subledger: summary.totals.bookValue,
        control: money(ledgerBookValue),
        difference: money(ledgerBookValue.minus(registerBookValue)),
        reason: null,
        details: {
          cost: summary.totals.cost,
          accumulatedDepreciation: summary.totals.accumulatedDepreciation,
          counts: summary.counts,
          accountDifferences: accountRows
            .filter((r) => !isZero(r.difference))
            .map((r) => ({ code: r.code, difference: r.difference })),
        },
      };
    } catch (error) {
      return incomplete('fixedAssets', error);
    }
  }
}
