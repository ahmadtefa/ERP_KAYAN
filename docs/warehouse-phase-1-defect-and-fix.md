# The negative stock balance: what broke, and what was changed

This is the record of Phase 1 of the warehouse work: the defect that turned a
stock issue into a database error, the cause of it, and every change made
because of it. Numbers quoted here are from the runs named at the end, not from
expectation.

## What the operator saw

```
DriverAdapterError: new row for relation "stock_balances" violates
check constraint "stock_balances_quantity_nonnegative"
originalCode: '23514'
Failing row: (…, -4.0000, -60.0000, 2026-11-01 18:16:23.304)
```

A sale, an issue or a transfer ended in a 500 with no indication of which item,
which warehouse or which figure was short. The database was telling the truth;
four units and sixty pounds had been taken off a balance that never held them.

## Why it happened

Two independent faults, both in how the two stock books are written.

1. **The shelf book had no constraint and was written with a delta.** A posting
   upserted `warehouse_stock_balances` with `quantity: { increment }`. If the
   row did not exist, the upsert created it *already negative*: a shelf that
   never held the goods it was issuing. The branch roll-up that followed
   (`stock_balances`, which does carry the check) then tripped the constraint.
   Nothing refused the movement before the write, so the only defence was the
   database, and the only message was the constraint's.

2. **Reversing a sales invoice incremented the branch book by hand.** It raised
   `stock_balances` and never touched the shelf. From then on the branch claimed
   stock the warehouse did not hold, and every later issue from that warehouse
   disagreed with the branch by exactly the quantity ever returned.

## The rule now

One protocol, in one place (`StockLedgerService.post`), used by every path that
moves stock - receipt, issue, sale, sale reversal, purchase return, transfer,
count, adjustment, write-off:

1. **create at zero** if the row is missing (`ON CONFLICT DO NOTHING`), so a
   balance is never *inserted* with a figure;
2. **lock it** (`SELECT … FOR UPDATE`), so a concurrent posting queues behind
   this one instead of reading the same balance and writing the same result;
3. **read it back inside the lock** and compute the result in memory;
4. **write the result as an absolute figure**, never as an increment, so a
   retried or doubled call cannot apply the movement twice.

The branch book is refused below zero **unconditionally**. It is the figure
every report and reconciliation reads, and the database enforces it; refusing in
words turns a 500 into a refusal that names the item, the figure held and the
figure asked for, in Arabic and English. `allowNegativeStock` still governs a
single *shelf* - one warehouse may briefly go negative when the company says so
- but a branch total never does.

An emptied shelf or branch is forced to zero value, so a rounded average cannot
strand a fils on a balance that holds nothing.

`reconcile()` compares the branch against the sum of its shelves and reports the
difference in quantity and in value. A difference means a writer bypassed the
ledger, and this is how a person finds that out before a valuation report does.

## The other three faults the audit found

Fixing the balance exposed, one after another, faults that had been hidden
behind the 500. Each is fixed at source and has a check that fails without it.

* **A reversed sale never put the goods back on the shelf.** The reversal now
  posts through the ledger, so both books move together.
* **A transfer and a write-off carried a cost of zero on their own document.**
  The movements were valued correctly (15.00 a unit, 30.00 for two) while the
  line, and therefore the printed transfer, read 0.0000 - the column whose
  comment promises "quantity x unitCost, snapshotted". Both now snapshot the
  figure they moved at.
* **A transfer moved quantity and left the lots behind.** The source lot went on
  claiming goods that had already left, and the destination held stock no lot
  could account for, so a later issue was refused for a shortfall on a shelf
  that visibly showed the goods. Lots now travel with the goods - soonest expiry
  first, same number, same dates, same cost, an emptied lot closed rather than
  deleted, and never more at the destination than left the source.

## One policy changed on purpose

Posting a write-off used to refuse the person who had approved it, reusing the
approval's own message. The effect was that booking a loss needed three people -
one to record, one to approve, one to post - so on a company with one store
manager a write-off could never be posted, and the goods were gone while the
document stayed a draft. Approval remains the separation of duties (the person
who records a loss still cannot sign it); either the approver or the recorder
may now post an approved write-off.

## What was not weakened

No database constraint was dropped, relaxed or bypassed. `stock_balances`
keeps `stock_balances_quantity_nonnegative`; no migration in this work touches
it. No test was deleted to make a suite pass; four expectations that were
themselves wrong were corrected, each with its arithmetic in the commit message
(570 vs 540 for a branch that a transfer leaves unchanged in value; `'DRAFT'`
vs `'draft'`, the shape the screen compares against).

## How this is isolated from the open pull requests

* The work is two commits on `arena/7b5dfd31-erp-kayan`, on top of `929bf6f`
  (the head of PR #67), and nothing else: `stock-ledger.service.ts`,
  `sales-invoices.service.ts` and its four specs, `stock-documents.service.ts`,
  `verify-inventory-postgres.ts`, four new warehouse specs, one spec helper, one
  new migration for existing databases, and the backup/reset/import services
  that had been waiting uncommitted for the inventory tables.
* **PR #67 is not merged, not edited in its description, and not rebased.** Its
  review is unchanged and independent; these commits are additional and can be
  reviewed commit by commit.
* **PR #71 (`arena/inventory-lots`) is a different branch** (`945c542`) and was
  only read, never written to. It is not an ancestor of this branch and shares
  no commit here.
* No branch other than this one was created, pushed or deleted.

## Evidence

| What | Where |
| --- | --- |
| 1,174 unit tests, 9 skipped | `npx jest` - backend |
| 8 ledger invariants against a Postgres-like harness | `stock-ledger.service.spec.ts` |
| 44 tests for stock takes, warehouse access, the twenty reports, write-offs | `stock-takes.service.spec.ts`, `warehouse-access.service.spec.ts`, `inventory-analysis.spec.ts`, `stock-documents.write-off.spec.ts` |
| 7 tests for lots travelling with a transfer | `stock-documents.transfer-lots.spec.ts` |
| Real PostgreSQL: 30 engine checks | CI job "Lot, shelf and alert engine (real PostgreSQL)" running `backend/scripts/verify-inventory-postgres.ts` |
| Real PostgreSQL: API smoke and regression scenarios | CI jobs "Backend (real Prisma and PostgreSQL smoke test)" and "Regression scenario (reported issues 1-9)" |

The real-PostgreSQL checks include the ones written for this defect: the branch
equal to the sum of its shelves to the fils, an issue with nothing behind it
refused in words while leaving no row behind, each shelf holding what its lots
hold, and two simultaneous issues where exactly one may succeed.
