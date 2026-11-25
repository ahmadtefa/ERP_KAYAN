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

## locpatch38 scoped repair and UI create checkpoint

- Added nullable movement lotUnitCost migration, regenerated local Prisma, migrated only synthetic engines. Original per-leg batch reversal identity, exact lot-shelf shortage, conflicting source/target batch and legacy null lot-cost refusal probes pass. Actual receipt repricing reversal now restores original lot contribution while financial movements restore their own book contribution.
- Earlier named-lot accounting objection reclassified: docs/RECOVERY_AUDIT_REPORT_20261107.md lines205,225-231 records warehouse moving-average accounting distinct from informational lot cost. Independent separate-bases test passes forward and inverse (books48, physical lot36; both restored). No valuation policy changed.
- Native38 exact cost assertions pass on source/target repricing, specific LOT_SHELF_SHORT refusal unchanged, reverse-first/issue-refused overlap leaves lot5=ledger5. Native synthetic journals balanced.
- 39 production weakening excluded. Fixture-only itemBatch.count and q/quantity aggregate shape repaired warehouse guard27/27.
- Generic transfer create has explicit source lot picker from authenticated item/warehouse paged batch API and physical ledger location availability. Availability labelled base units. Split line creates blank quantity/lot with same item/unit/locations, requiring explicit allocation. Barcode does not merge into already sourced/lot-selected lines.
- Actual generic barcode Flutter HTTP/services/native PG14 create/post/reverse passes selected persisted batchId/qty3/source10 restored,target0. This bridge omits controller/auth/licence. EN and AR screenshots inspected readable at desktop size. Existing screen21/21 plus AR1 pass, analyze clean.
- Existing draft batch/split correction remains pending backend41 contract. Full SQL suite after38 interrupted by120s call boundary, not claimed complete; independent scenario chunks passed including legacy null/conflicting2 and separate-bases1, earlier38 run19 passed and one then-policy assumption failure now corrected.

## locpatch41 and explicit split UI checkpoint

- Production41 integrated with overlapping worker spec excluded. Independent distinct-lot frozen-factor split preserves entered0.3333+0.6667 carton, base0.9999+2.0001 at factor3, post/reverse shelf/warehouse/lot restoration passes.
- Draft correction UI offers explicit lot or two-part split with per-part source picker and lot, entered-unit quantities and exact-sum validation. Backend supports2-20 parts; UI supports2 per operation, larger splits remain unqualified. Save failure keeps entered part quantities/lots and inline reason.
- Actual Flutter existing draft split2+1 HTTP/services/native PG14: first synthetic server refusal displays reason and keeps summary; retry save creates two lines, then post/reverse restores original source10/destination0. Synthetic server refusal tests retention, not a production stock error.
- Fixed UI controller disposal during split dialog closing by letting input widgets own lifecycle.
- Create and correction source/destination review now shows actual location identity; correction loads receiving location code when available, preserves unavailable id if fetch fails. EN/AR create screenshots visually checked; AR split pixels remain to inspect.
- Stockdoc SQL split chunks11+11 and new distinct split1 pass (23 non-opt-in cases across chunks); opt-in old correction bridge not rerun after41. Unit warehouse guard27/27 with fixture-only repair. Generic stockdoc widgets22/22, full analyze clean; TypeScript clean before latest UI-only changes.
- Remaining: native41 edit/post overlap for split, controller DTO/permission chain for split, AR split visual, direct item-picker create bridge, wider every-control register and installed licence/release. No production DB, remote push/CI or release changes.

## 05:15 native split overlap follow-through

- Native41 split/post overlap exact orders pass: split edit-first commits two lines/version1 then post succeeds; post-first commits original single line/version0 and split refuses. Synthetic harness setup quantity typo corrected before final rerun. Evidence patch41-native-split.out.
- Own shelf-overdraw fixture rechecked: positive transfer5 from B shelf4, expected STOCK_DOC_SHELF_SHORT, target lot5 and shelf4 unchanged, passing SQL chunk. Worker reported a different negative fixture, not copied here.
- Correction destination code fetch implemented; create EN/AR actual shelf labels rendered and inspected. AR split/controller HTTP split/direct item picker remain unqualified.

## locpatch42 qualification, 05:22

- AR existing-draft split bridge save/refusal/retry/post/reverse passes. Actual RTL pixels inspected with sourceA, targetT, retained2+1 lot summary.
- Actual direct item-picker generic transfer create/post/reverse passes nativePG via KAYAN_DIRECT_ITEM=1. Catalog item and batch truth from SQL/services; stock/picture metadata deliberately synthetic. No controller/auth claim on UI bridge.
- Split Nest HTTP production session/principal guard, permissions, branch guard, controller, service and nativeSQL pass: live adjust deny403 unchanged, entered2+1 DTO retains lot ids, refreshed2 lines/version1, stale409 no duplicate. Signature decoder fixture, not real JWT signing/login/licence.
- Independent multi-original split exposed duplicate next-line allocator41;42 fixes request-wide allocation. Former failure now four unique lines and post/reverse PASS. Later invalid second-row lot rolls back all earlier split writes/version0/stock unchanged. Distinct-lot frozen carton split still passes.
- Native42 two-original split/post exact orders pass: edit-first4 lines/version1 then post, post-first2 original lines/version0 and split refuses. Server stopped, all synthetic journal sums0.
- Analyze and TypeScript noEmit clean. Worker test hunks excluded when overlapping independent regression cases. Logs patch41-ar-split.out, patch41-split-auth.out, patch41-direct-item.out, patch42-split.out, patch42-rollback.out, patch42-native.out.
- Remaining acceptance: full every-control register unchanged35 mapped/156 open; installed Windows login/licence/device/installer; generic reversal other kinds, repeated-equal-line historical ambiguity/sourceLineId coverage; no universal multi-lot feature claim (explicit one-lot per line supported, split limited2 per UI operation).

## Generic non-transfer reversal gap, 05:23

Transfer42 proofs remain scoped. New independent positive ADJUSTMENT+2 and generic COUNT10->8 post/reverse tests fail: ledger and warehouse restore but itemBatch remains12 or8 rather than10. reverse lot loop only restores WRITE_OFF and negative ADJUSTMENT. Backend owner notified; positive COUNT probe added awaiting run. Do not present generic stock-document reversals as fully accepted. Evidence patch42-generic-reverse.out.
