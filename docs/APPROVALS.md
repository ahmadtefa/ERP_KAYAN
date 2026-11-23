# الموافقات الإدارية — Configurable approval chains

How a company decides *who must approve what*, and how a stock transfer moves
through the doors that chain creates. This supplements
[`RBAC_AND_NOTIFICATIONS.md`](RBAC_AND_NOTIFICATIONS.md), which covers the
permission model itself.

---

## 1. What was already there

The staged transfer lifecycle existed before this work and is unchanged:
`DRAFT → REVIEWED → APPROVED → DISPATCHING → DISPATCHED → RECEIVING →
RECEIVED → SETTLING → SETTLED → CLOSED`, with transit warehousing, partial
receipt, shortage/damage settlement and a separately-approved write-off. The
31-check `scenario-warehouse-cycle.mjs` proves it end to end, and still does.

What was **missing** was the configurable layer: the two approval doors were a
single review and a single approval, hard-coded, with no per-branch, per-shelf,
per-value or multi-level behaviour, and no way to return a request for
amendment as distinct from rejecting it.

## 2. The one rule that makes this safe to ship

> **A company that writes no policy keeps exactly the behaviour it has today.**

That is represented explicitly as `source: 'LEGACY'` rather than "an empty
chain happens to pass", because an empty chain that passes looks identical to a
half-configured policy, and those two must never be confused. An installation
with existing data can take this migration and change nothing.

## 3. Configuring a chain

Three tables, all additive (`20261123170000_approval_policies`):

| Table | Holds |
| --- | --- |
| `approval_policies` | The rule: operation, name, priority, and its conditions |
| `approval_levels` | The ordered steps, each naming a permission and optionally a role |
| `approval_decisions` | Append-only history: who decided which level, when, why |

A policy matches on any combination of: **branch**, **source warehouse**,
**destination warehouse**, **minimum amount**, **minimum quantity**. Every unset
condition is a wildcard. The lowest `priority` wins; a tie breaks on the policy
id so the answer is stable rather than dependent on row order.

```
GET    /admin/approvals/operations
GET    /admin/approvals/policies
POST   /admin/approvals/policies
PATCH  /admin/approvals/policies/:id
DELETE /admin/approvals/policies/:id
GET    /admin/approvals/history/:entityType/:entityId
```

Guarded by `admin.approvals.read` / `admin.approvals.manage`. These are
deliberately **separate from the right to decide a level**: an operator who may
approve a transfer cannot widen the rule that governs their own authority.

## 4. How a transfer follows a chain

| Route | Meaning under a configured chain |
| --- | --- |
| `POST /inventory/stock-transfers/:id/submit` | The requester opens the chain → `PENDING_APPROVAL` |
| `POST /inventory/stock-transfers/:id/approve` | Decides the **pending level**; `APPROVED` only when all levels are done |
| `POST /inventory/stock-transfers/:id/reject` | Ends the request → `REJECTED`, reason recorded |
| `POST /inventory/stock-transfers/:id/return` | Sends it back to its author → `DRAFT`, editable and resubmittable |
| `GET  /inventory/stock-transfers/:id/approvals` | The path: every level, its state, who closed it, when, why |

`review` keeps its historical meaning. Under a configured chain it answers 409
pointing at `/submit`, because submitting is the requester's own act and is
guarded by `inventory.transfer.create` — not by an approver's permission.

**Four rules the engine enforces, each testable:**

1. **No self-approval.** The requester may never decide any level, even holding
   `*`.
2. **Level permission *and* level role.** Holding `inventory.transfer.approve`
   is not enough if the level names `GENERAL_MANAGER`.
3. **No skipping levels.** An out-of-order approval does not satisfy the level
   before it; the chain waits at the first unsatisfied one.
4. **One approval per level.** A partial unique index
   (`approval_decisions_one_approval_per_level_idx`) settles two people clicking
   at the same moment; the loser gets a 409, not a double approval.

A **rejection** and a **return** are different outcomes, deliberately. A
rejection ends the request. A return leaves it editable, keeps the reason on the
record, and allows resubmission; earlier decisions remain in the history.

## 5. Where a threshold is measured

The amount a policy compares is the value of the goods being moved —
`requestedQuantity × unitCost`. A line's `unitCost` is only filled in at
dispatch, so on a draft the engine falls back to the item's own cost price, then
its sale price. Without that fallback, every draft would value at zero and
silently dodge its own approval rule. If the company has priced an item nowhere,
it is worth zero and the rule does not fire — which is the honest reading.

## 6. Notifications

Two kinds were added:

| Kind | Who sees it | Permission |
| --- | --- | --- |
| `STOCK_TRANSFER_LEVEL_PENDING` | Whoever can close the **pending** level | the level's own permission, passed per-alert |
| `STOCK_TRANSFER_RETURNED` | The requester | `inventory.transfer.create` |

The level alert carries the level's own permission rather than the kind's
default, so an alert about a `GENERAL_MANAGER` level does not appear in a
storekeeper's list. The transfer's `actionPath` opens the document, and the
`(companyId, dedupeKey)` index guarantees one alert per fact — deciding a level
moves the task rather than adding a second one.

## 7. What is deliberately *not* here

* **New business modules.** The engine governs `STOCK_TRANSFER` only. The
  `operation` column and the resolver are written to extend to issue,
  write-off and discount without a second table, but no such policy is accepted
  today: a setting that nothing enforces is a setting that lies.
* **Isolation changes.** Transfers keep their existing company/branch/warehouse
  checks; approval policies are company-scoped and proven so.

## 8. Tests

| Suite | What it proves |
| --- | --- |
| `approval-chain.spec.ts` | 23 cases: matching, thresholds, ordering, ties, skip-ahead, stop-on-reject, separation of duties |
| `stock-transfers.approval.integration.spec.ts` | 16 cases on a real PostgreSQL schema: legacy passthrough, chain open, dispatch blocked while pending, two levels, self-approval, wrong role, out-of-order, reject, return + resubmit, threshold below/at, company isolation, alerts |
| `approvals.postgres.spec.ts` | 10 cases on a **real server**: permissions seeded, renumbering, a recorded decision, requester refused, **two simultaneous deciders → exactly one approval**, company isolation, wholesale level replacement, history survives policy deletion |
| `scenario-warehouse-cycle.mjs` | The 31-check cycle, unchanged and still 31/31 |

Real-PostgreSQL specs run with `KAYAN_APPROVALS_PG=1`; the acceptance database
specs keep their existing `erp_kayan_acceptance` requirement.

On CI, `PostgreSQL 16 (accounting)` is red — but it is red on the base commit
too, with the same 17 checks, all in the reset / dashboard / report paths that
this work deliberately left alone. Running the scenario against both commits
showed this branch fails a strict subset: no new failure, one fixed. It is
recorded here so nobody later reads that red job as evidence about approvals.

## 9. Where the code is

| Concern | File |
| --- | --- |
| The decision arithmetic (pure, no Prisma) | `backend/src/common/approvals/approval-chain.ts` |
| Persistence, validation, enforcement | `backend/src/common/approvals/approvals.service.ts` |
| Configuration API | `backend/src/common/approvals/approvals.controller.ts` |
| Transfer integration | `backend/src/modules/inventory/stock-transfers.{service,controller}.ts` |
| Schema | `backend/prisma/migrations/20261123170000_approval_policies/` |
| Screen | `lib/features/inventory/presentation/screens/stock_transfers_screen.dart` |

## 10. Prices a storekeeper must not see

The price fix in section 5 has a second half. A transfer is *valued* using the
item's purchase price, so if that price is readable by anyone who can move
stock, the approval thresholds are readable too — and so is every supplier's
margin. The two requirements are the same requirement.

Verified over HTTP against a real server, with two real accounts:

```
ADMIN  182 permissions (inventory.cost.read, purchases.price.read, sales.price.read)
       items[0] -> purchasePrice 100.0000, salePrice 150.0000

STOREKEEPER  6 permissions, none of them a price permission
       items[0] -> purchasePrice (absent), salePrice (absent)
       keys: barcode, categoryId, code, companyId, ... reorderLevel, taxRate, unit, units
```

The keys are removed, not nulled: a field that is present-but-null invites a
client to guess it holds a value, and the screen would then render a price
column for somebody who is not allowed to read one. Without `inventory.items.read`
the same request is refused outright with 403, and without a token with 401.

Re-running the same two accounts is the regression test: if a price
permission ever leaks into a stock-only role, or a redaction path is skipped,
this payload changes.
