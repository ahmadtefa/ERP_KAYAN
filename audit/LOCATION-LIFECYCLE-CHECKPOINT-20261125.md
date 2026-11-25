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
- Count complete authentication/licence chain. Count Flutter HTTP/service/SQL REVIEW bridge passed separately.
- Accounting opening Flutter HTTP/controller/service/native PG14 draft/read/post passed (qty5, value10, selected shelf persisted). Separate Nest HTTP guard/controller/native SQL tests passed with a signature-decoder fixture, not real login/signing/licence.
- Generic transfer reversal currently FAILS independent SQL acceptance: warehouse totals restore but exact shelves/lots do not. Backend owner notified; no acceptance claim. Basic writeoff post/reverse exact shelf/lot/warehouse passes.
- Full general stock-document reversal lifecycle across all kinds/lots/shelves.
- Master-data restore can update lot-policy fields without a verified stock-policy transition. Inspection only, no import policy changed.
- Historical cases lacking enough original evidence now refuse. No automatic data cleanup or invented batch/date.

These results are scoped tests, not a claim that every warehouse workflow or all six work areas are complete. No production database, main branch, signing, release, or public publication changed.

## 04:48 continuation evidence

- New opt-in `test/widget/opening_locations_http_test.dart`, launched by the isolated native harness with `KAYAN_OB_LOCATION_UI=1`, exercises draft form with shelf, save, detail read and confirm post through production controller/service. SQL verifies qty5/value10 and shelf on original movement.
- Posted UI screenshot inspected: readable status, balanced debit/credit10 and stock/equity lines; posted detail does not display shelf or stock quantity (not claimed as displayed).
- `KAYAN_OB_AUTH=1` uses Nest routes, production JWT session/principal guard, permissions and branch-write guards, controller/service and native SQL. Only signature decoding is a fixture. Missing/invalid credentials401, live permission denial403 and zero draft writes, foreign-branch create403, no-cost stock create403, detail costs redacted, session revocation401 pass. Production auth code unchanged.
- Logs `/tmp/patch37-ob-ui.out`, `/tmp/patch37-ob-auth.out`, `/tmp/patch37-reverse.out`. Native synthetic cluster stopped.
- Full Flutter analyze clean. TypeScript noEmit clean with1536MB heap;384MB attempt exhausted heap and was rerun, not a source error.
- Two stock-document reversal probes added. Transfer fails: A3 versus6, C8 versus5, source lot7 versus10, destination lot8@8.25 versus5@6. Basic writeoff exact reversal passes. Do not present the expanded stock-document suite as green until transfer corrected.

- Additional forward transfer failure: incoming movement uses source batch ID, whereas destination lot is a different row. Exact destination lot shelf availability excludes the incoming3. Added identity and shortage regression tests; shortage setup dynamically leaves1 on the destination lot shelf before attempting reverse3. Current reversal incorrectly commits. Production owner notified.

## locpatch36 provisional integration

Production service hunk integrated. Worker test hunk overlapped independent probes and was excluded. Basic exact transfer reversal now passes. Still FAIL: forward destination batch identity, exact destination-lot shelf shortage, repriced source cost, conflicting original batch identity (reverse wrongly commits). Destination additional receipt cost test passes. Logs patch36-reversal.out, patch36-reprice.out, patch36-legacy.out. Not accepted.

## locpatch37 provisional qualification

- Production hunk integrated, overlapping worker test hunk excluded. Forward single-lot IN binding now passes. Basic reverse, depleted original lot shelf without unrelated stock, and real receipt source/target repricing refusal pass. Refusals preserve quantities/value/status.
- Still FAIL: conflicting original batch evidence accepted; reversal outgoing movement binds source batch instead of original destination batch. Destination-lot ledger remains8 while lot5 after reverse. Exact lot/shelf guard and partial/multi-lot forward coverage not accepted.
- Native PG14 probe `KAYAN_DOC_REVERSE=1`: actual source/target receipts refuse unchanged. Depleted target lot plus unrelated lot at same shelf also refuses, but via later-IN cost guard because shelf move generates IN, so this is not proof of an exact lot-shelf guard.
- Paused destination issue before mutation, reverse completed first and issue refused afterward. This order alone is not corruption or failed serialization. Native final invariant DOES fail: destination lot5 versus its movement ledger8, corroborating wrong reversal batch binding. No deadlock observed. Logs patch37-native-reverse.out. Harness records `consistent:false` even though process exits0: never treat exit0 as acceptance.
- TypeScript noEmit clean; no UI production changes this patch. Synthetic native server stopped after inspection.
