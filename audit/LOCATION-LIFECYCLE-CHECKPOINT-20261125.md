# Storage-location checkpoint, 2026-11-25

## Implemented and independently exercised

- Purchase and sales source allocations, durable original-line and return-line movement bindings, exact-source returns/reversals, safe refusal of ambiguous or incomplete historical evidence.
- Direct batch transfer source shelf and optional destination shelf, including unchanged typed units and quantities.
- Stock-document transfer source/target and guarded draft location correction. Actual Flutter to HTTP to production services to migrated SQL recovery passed. Controller/auth/licence chain omitted from this bridge.
- Count snapshots per lot and shelf, unlocated remainder, add-zero-baseline shelf row, explicit assignment versus real variance labels. Neutral assignments preserve lot, warehouse and branch quantity/value in scoped tests.
- Count concurrency: duplicate add, finish/add and finish/record serialize; late record refuses and Flutter retains typed figures. Cost redaction covers real variance value.
- Item-create opening stock optional shelf. Actual service persistence and invalid-location atomic rollback passed.
- Accounting opening balances: lot-less branch/warehouse/shelf post/reverse, duplicate claims, issue overlap, historical warehouse-NULL compatibility. Tracked goods refuse until an accountant-reviewed traceable opening workflow exists. Ambiguous/incomplete original movements refuse before reversal writes.
- General writeoff uses selected warehouse valuation, including whole-position drain. The independently reproduced branch/warehouse value drift is fixed.

## Latest bounded evidence

- Flutter analyze: no issues.
- Broad changed-screen Flutter tests: 71 passed.
- Backend TypeScript noEmit: clean.
- Relevant service/controller unit tests: 115 passed across seven suites.
- Migrated SQL: purchases 24 passed; sales 20 passed with one opt-in bridge skipped; stock documents 10 passed with opt-in bridge separately passed; counts 9 passed.
- Isolated native PostgreSQL 14 independent clients: scoped receipt, issue, transfer, return, reversal, draft correction, count and opening contention assertions pass. Synthetic cluster stopped after runs. All synthetic journal debit-credit totals net to zero.

## Still unqualified

- Authenticated installed Windows workflow, licence chain, release and installer.
- Full every-control acceptance. The existing partial source-site register remains 35 mapped and 156 unmapped. New controls were not silently counted as accepted.
- Count and accounting-opening complete Flutter/HTTP/controller/auth/SQL chains.
- Full general stock-document reversal lifecycle across all kinds/lots/shelves.
- Master-data restore can update lot-policy fields without a verified stock-policy transition. Inspection only, no import policy changed.
- Historical cases lacking enough original evidence now refuse. No automatic data cleanup or invented batch/date.

These results are scoped tests, not a claim that every warehouse workflow or all six work areas are complete. No production database, main branch, signing, release, or public publication changed.
