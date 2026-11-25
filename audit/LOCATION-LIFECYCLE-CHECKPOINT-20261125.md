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

## 05:26 retained correction follow-through

- Changed UI broad regression65/65 pass; current generic stockdoc22/22 pass. Explicit source lot null clearing is sent, written-off lots excluded. Destination change clears stale split preview.
- After synthetic save refusal, reopening split now retains typed part2/1 and chosen lot in editable fields, then reapply/retry/post/reverse passes actual Flutter/native bridge. Evidence patch42-retained-edit.out. Analyze clean.
- Generic COUNT positive12 also confirmed lot12 after reverse instead10; correction remains with backend owner. Transfer qualification is not generic reversal acceptance.

## locpatch43 provisional, 05:29

- Own positive ADJUSTMENT and COUNT± inverse tests now pass exact remaining/received/status/cost/warehouse/shelf restoration, basic writeoff inverse retained. Null and conflicting original batch refuses atomically. Exact original lot shortage with unrelated stock on same shelf refuses LOT_SHELF_SHORT unchanged.
- Native43 actual adjustment+/count± restores remaining10/received10/statusOPEN/lotcost12 and warehouse10/value120. Reverse-first versus issue overlap valid, final lot=movement ledger=warehouse. All journal totals balanced, server stopped. TypeScript noEmit clean.
- New transfer omitted-lot case remains FAIL: line omits batch but post auto-selects sole covering lot into existing destination lot; reverse restores shelf/books but skips lot restoration, leaving source7/target8 instead10/5. Backend notified, regression saved. No universal reversal acceptance.

## Generic lot cost after later receipts, 05:30

43 exact basic inverse passes, but positive adjustment+2 then real receipt2@24 then reverse from original10@12 yields lot12@13.7143 vs expected14, books12/value168 correct. Negative adjustment-2 then same receipt/reverse also fails lot contribution restoration. Physical lot and book costs remain separate bases, neither should be silently repriced by inverse. Backend owner notified for recorded physical contribution or fail-closed proof. New tests allow an atomic refusal as safe outcome. Evidence patch43-reprice.out, patch43-negative-reprice.out.

### 05:32 split source visibility and broad local unit regressions
- Explicitly show each staged split part's physical source code beside its quantity and lot, rather than hiding differing sources behind the common line summary.
- Actual Flutter retained-refusal/edit/save/post/reverse native bridge passes with the source-aware summary. Inspected screenshot `/downloads/stock-document-lot-split.png`: readable A source per part and T destination, no overlap.
- Full Flutter analyze clean. Stockdoc units/controller/warehouses/cost/source/writeoff/transfer-lots/warehouse guard and response permissions: 9 suites, 80 tests pass locally. These do not override the three known isolated integration failures.

### 05:33 extended inverse failures, explicit fixture scope
- Writeoff2 then actual receipt2@24 then inverse: physical lot12@14.4 vs expected14. Same original physical contribution loss as negative adjustment, not a warehouse valuation-policy change.
- Synthetic legacy mismatch: post generic adjustment+2 with named lot then clear only the posted line's batchId. Reverse succeeds, ledger/books restore10 but lot stays12. Must bind proven original identity or refuse atomically. This is intentionally a corrupted/legacy fixture, not evidence that UI can clear a posted line.
- Both probes allow exact inverse or unchanged atomic refusal. Both currently fail. Reported to parent for backend owner. `/tmp/patch43-extra-inverse.out`.

### 05:40 patch44 independent qualification, legacy transfer still open
- Applied service hunks only. Worker tests excluded. New omitted-lot tracked transfer refuses with explicit lot/split correction and data retained. Physical lot cost evidence uses nullable migration38 column, reads only original movement IDs. Generic line/original lot mismatch now refuses including null line.
- Own PGlite8 probes pass: positive/negative adjustment and writeoff after actual receipt exact cost, new omitted-lot refusal, cleared generic line refusal and basic adjustment/count± inverses. Additional3 pass: count± after actual receipt, generic null-cost legacy refusal with truthful accountant review guidance.
- Native PG14 expanded actual-receipt inverses adjustment±/count±/writeoff all restore12@14, received12, OPEN, books168; generic issue/reverse overlap remains consistent. Full harness journals balanced. Server stopped.
- 9 unit suites80/80 pass. Writeoff unit now asserts precisely one lot-cost evidence UPDATE and exact parameters, not merely absence of CLOSED text. TypeScript noEmit clean.
- Remaining FAIL: synthetic legacy transfer line.batchId null with proven original lot movements and destination lot merged into preexisting lot. Reverse still succeeds leaving lots unchanged while reversing ledger/books. New-post refusal does not protect old documents. Own test saved and reported.
- Full37-case PGlite single run exceeded120sec and stopped, no claim of full-suite pass. Smaller scoped groups used.

### 05:43 patch45 identity closeout and bounded gate
- Applied service hunk only; own failing legacy merged-transfer cleared-line test now refuses unchanged. Identity group5/5 pass; additional forged receiving movement bound to another stocked target lot refuses unchanged,2/2 pass.
- Current45 native PG14 combined generic and transfer harness passes: exact later actual receipt adjustment±/count±/writeoff inverse, source/destination transfer repricing, lot-shelf shortage and generic/transfer inverse-v-issue overlap. All synthetic journals balanced; native server stopped.
- TypeScript noEmit clean.44 bounded PGlite baseline14, transfer/reprice8, split/identity6 pass. Earlier44 generic inverse8/count+legacy3 pass. No single full-suite completion claimed. All five observed43 failures now covered by later fixes or atomic refusal; repeated equal-line/sourceLineId identity remains a limited proof boundary.
- No CI/push/release/install. Full inventory per-control register remains incomplete; real Windows login/licence/installation and production databases untouched.

### 05:46 current UI bridges, native legacy refusal and register supplement
-45 actual direct item picker and barcode generic create/explicit lot/post/reverse bridges pass;45 Arabic split refusal-retained/reopen/edit/save/post/reverse bridge passes. Full Flutter analyze clean. These synthetic local service bridges do not prove real login/installation.
- Added explicit native legacy merged transfer line-null fixture: exact ambiguity refusal preserves all lot received/remaining/cost/status, warehouse books, movement count and posted status. Combined native transfer regression and barcode bridge pass; server stopped.
- Partial191-site source register now42 mapped widget/149 open after mapping seven existing stock-document create/filter/refresh/search/post/cancel/submit controls to22 passing widget cases. Original line numbers are snapshot locators. Newly added lot/split controls remain separate lifecycle evidence, not silently folded into denominator. No all-controls claim.

### 05:53 bounded control coverage and repeated equal-line check
- Repeated equal quantity/equal book cost lines on distinct lots and shelves, adjustment and transfer, both exact inverse in own PGlite tests (not merely permitted refusal),2/2. This proves the exercised order only; movement-to-line key remains absent, so do not generalize to arbitrary ordering/legacy identity.
- Added three batch-list controls: expired/expiring/all filter cycle, trimmed search/clear, refresh without stock submission. Batch widget suite32/32 passes. Partial original191-site register45 mapped/146 open. Evidence remains widget-only for these controls.
- TypeScript clean after repeated-line probes; full Flutter analyze clean after controls. No production/backend behavior changed in this checkpoint.

### 05:55 item-location controls and batch backend coverage
- Batches operations SQL16/16 non-opt-in cases pass in two8-case groups: receive/issue/transfer/writeoff/list. The opt-in actual Flutter receipt bridge is not counted as rerun here.
- Item-location widget9/9 pass including new cancel-without-mutation and prior scoped target/quantity/reason/retained-refusal/uncertain-block/refresh checks. Mapped8 original source sites to these tests, callback branches only where exercised. MAPPED_WIDGET never means every branch or SQL acceptance.
- Partial original191-site register now53 mapped/138 open, with substantial dedicated transfer/voucher/count forms still unqualified in the register. Full Flutter analyze clean.

### 06:06 warehouse and access control proof
- Added warehouse refresh without mutation, chosen-row edit preserves branch and excludes immutable code, access people refresh without grant mutation. All33 warehouse/access widget tests pass. Initial new edit test incorrectly assumed an editable code field; fixed test to actual immutable-code contract, no production change.
- Mapped12 original source sites to specific passing warehouse/access tests, including prior create/search/balances/activation and scoped grant-save/switch/chip tests. Partial register65 mapped/126 open. These are synthetic widgets only, not actual permission mutations or SQL qualification. Full analyze clean.

### 06:09 stock-count control proof and worker provenance
- Added stock-take refresh without stock action, back from cancel+close without mutation, confirmed approved-session post+refresh. Count and barcode widget suites37/37 pass, full analyze clean. Initial new post test assumed wrong fixture id; corrected to approved st-2, not reviewed st-3. No behavior change.
- Mapped11 more original callback sites: count input/error clear, cancel reason/back, row post/refresh/self-approval disabled, barcode lot choose/cancel, details close. Register76 mapped/115 open. Remaining count new-warehouse selection, detail approve/post not inferred from row controls.
- Parent reported backend worker scope (not independently rerun here):45 storage-locations.lifecycle21 individually; approvals17 individually split44/45 (no reverse);44 units lifecycle6, barcode6, dedicated transfer6, transfer-lots8/guard27/writeoff15 scoped. Preserve version and individual-run limitations; no aggregate full-CI/installation claim. Worker idle.

### 06:10 original-movement read ordering proof boundary
- Injected reversed original-movement read order only in test adapter; same valid equal-quantity/equal-book-cost distinct-lot adjustment and transfer now both refuse atomically with STOCK_DOC_REVERSE_LOT_AMBIGUOUS. Two probes pass unchanged shelves/lots/books/status.
- Normal tested order exact inverse; arbitrary order not guaranteed usable because no movement-to-line key. This is a known safe-refusal usability limitation, not silent stock corruption. No production change or worker repair requested. TypeScript noEmit clean.

### 06:12 dedicated transfer/voucher evidence and reliable unit selector taps
- Dedicated transfer create/error retry and EN/AR details-scroll widgets3/3 pass. Mapped7 original sites, submit branch only where shared with Cancel.
- Voucher flow/field-error/barcode quantity28/28 pass. Replaced label-only unit taps with enclosing dropdown tap in two test files; same assertions pass with zero hit-test warnings. No UI implementation change.
- Mapped22 voucher sites to specific synthetic workflow/search/edit/retry/selector/quantity/cost/create tests. Partial original191-site register105 mapped/86 open. Unmapped pagination/report/history/add-remove/notes/date/remaining detail controls not inferred from neighboring cases. Mapped callback proof still not all branches or SQL/install proof.

### 06:17 patch46 deterministic line identity qualification
- Applied service hunks only. Generic document post writes existing sourceLineId on adjustment/count/writeoff and both transfer legs; reverse narrows original pool perline, falls back to untied legacy. No migration or opening-balance/stock-take changes inferred.
- Own reversed-read equal cost/quantity distinct-lot adjustment and transfer now require exact inverse and pass, no safe-refusal allowance. Transfer both-leg keys and duplicate/incomplete/mixed tied-untied/forged other-line atomic refusal plus unique untied legacy inverse7/7 scoped cases pass together. TypeScript noEmit clean.
- Current46 native PG14 generic actual later-receipt adjustment±/count±/writeoff costs, transfer source/target repricing/shortage/issue overlap and legacy null-line refusal pass; journals balanced. Current46 actual direct-item explicit-lot and Arabic retained split save/post/reverse Flutter bridges pass; server stopped. Native harness did not inject original read reordering, which is explicitly PGlite-backed.
- Current46 own real-receipt/split/fractional-unit/multi-original rollback group8/8, nine unit suites80/80, full Flutter analyze clean. Broader worker results retain earlier version-specific scope. No aggregate full-suite/CI/install/release claim.

### 06:25 item/writeoff/stock callback coverage
- Added writeoff refresh-no-mutation and confirmed signed-row post/refresh. New test initially assumed generic post path, corrected to dedicated write-off/post route actually used; no code path changed.
- Item-unit superadmin uncertain-save tests initially failed because extra cost columns placed Units action beyond1700px viewport. Added ensureVisible before same tap. All6 unit tests pass with retained input/uncertain duplicate block assertions unchanged and zero hit-test warnings. No permission/UI behavior change.
- Seven-file bounded item/writeoff/stock widget run37/37 passes, full analyze clean. Mapped10 more original source sites (writeoff4, stock2, items4), partial register115 mapped/76 open. Picture-editor isolated tests are not borrowed as proof for ItemsScreen launch button.

### 06:26 voucher page controls
- New page1->next2->previous1->next2->refresh2->search resets1 test preserves branch/voucherOnly scope and sends no stock create. Voucher flow22/22 passes, full analyze clean.
- Mapped refresh/previous/next original sites, partial register118 mapped/73 open. List row detail navigation remains open, not inferred from direct detail fixtures.

### 06:35 dedicated transfer draft remaining controls
- New synthetic test refreshes list without mutation, trims case-insensitive search, selects explicit unit+source lot, enters3 boxes, adds/removes second line, sends one intended line with exact unit/lot/quantity/notes and cancels subsequent draft without mutation. Existing error/idempotent retry preserved.2/2 pass, zero hit-test warnings after targeting dropdown parents. Full analyze clean.
- Mapped8 original sites, register126 mapped/65 open. Dedicated dispatch/receive/settle/report and other unexercised actions remain open, not inferred from draft test.

### 06:49 dedicated transfer operations callback proof
- New4 widget cases: dispatch remainder4, receive remainder2 after returns/writeoff, cancel each without mutation, confirm exact1.25 line+idempotency key+reload; settlement cancel/submit exact return/shortage/damage/reason; reject reason cancel/confirm; Done closes details. Full analyze clean.
- Mapped12 original source sites, shared action callback only dispatch/receive/settle/reject, not all status transitions. Partial register138 mapped/53 open. No SQL acceptance inferred from synthetic operations tests; unknown-outcome handling and retained rejected operation quantities still not qualified.

### 06:52 dedicated dispatch/receive/settlement retained failure repair
- New failure probe proved dedicated quantity dialog vanished after unknown outcome. Flutter now submits inside quantity/settlement dialogs, keeps all inputs, awaits acknowledged safe error, blocks duplicate submission on unknown outcome and explains close/refresh/check before retry. Definite4xx refusals keep editable inputs and corrected retry gets a new idempotency key. Backend contracts unchanged.
- Seven operation widgets pass including unknown dispatch and settlement, definite receive corrected retry; complete dedicated transfer widgets11/11 pass. Full analyze clean. Inspected actual-font retained settlement screenshot: all amounts/reason and warning readable, submit disabled, Cancel reachable. Initial Ahem-font screenshot discarded as unverified, replaced with actual fonts.
- Source file formatting expanded preexisting compressed transfer screen, with brace lint fixes; no unrelated API/permission change intended. Report retains limitation: nonquantity detail actions still use prior failure path and need qualification.
- Follow-up gate correction: corrected-retry key assertion initially indexed the fake key log after its deliberate throw, so refused first attempt was not logged. Moved fake key capture before throwing; actual two-attempt keys differ and all11 dedicated transfer widgets pass on final code. No failed gate left represented as passed without rerun.

### 06:55 uncertain transfer close/refresh/reopen recovery
- Retained per-transfer unknown operation key and inputs in app provider state, across closing quantity/details and reopening. Same action reopens exact disabled draft; other stock actions refuse until source record reconciles. Details Refresh checks server action requestKey+stockDocumentId, only confirmed original operation unlocks; absence alone is not treated as failure or permission to resend. Banner names review/admin route.
- New unknown dispatch close->refresh->details close/reopen->same action probe preserves1.25 and blocked submit with only one request; original-key confirmed source refresh unlocks without resending. Dedicated widget12/12 pass, full analyze clean.
- Boundaries: recovery state is current app session, not disk persistence across app restart; settlement without definitive completed stockDocumentId remains blocked for admin review. No guessed completion from changed totals. Nonquantity action error retention remains separate follow-up.

### 06:57 durable unknown-operation recovery boundary
- Recovery key/input now saved with SharedPreferences before request send, scoped by API server/account user/company/transfer. Persistence failure prevents new send. Stores action idempotency key and minimal line quantities/reason, no credentials or diagnostic text. Confirmed success/definite rejection removes record; unknown keeps it.
- New provider recreation boundary in prior close/reopen test destroys full widget/provider tree, retains backing preferences, creates fresh tree, verifies exact1.25 still disabled and only one request. Exact original-key confirmed source action unlocks and removes durable record, no totals inference.12/12 dedicated transfer widgets pass, full analyze clean.
- This tests recreation through app persistence interface, not an actual installed Windows process restart. Real installed restart remains unqualified. Settlement without matching completed stock document remains blocked for review, never silently retried.

### 07:05 nonquantity transfer action retention and confirmation
- All detail nonquantity actions now use confirmation dialog; reject/return keep reason through refusal. Same durable pre-send unknown key/reason blocks duplicate across provider recreation. Raw detail-action/load errors replaced with acknowledged safe error. No backend policy or endpoint changes.
- Dedicated transfer widgets14/14 pass including neutral review cancel/confirm and unknown reject recreation. Actual-font screenshot inspected: exact reason, recovery guidance and disabled Confirm readable. Full analyze clean.
- Reconciliation gap explicit: nonquantity actions without completed stockDocumentId cannot currently prove completion through same-key evidence, so remain review/admin blocked rather than guessed from status. This is safe but limited automatic recovery, parent notified. Installed process restart not qualified beyond preference-backed recreation.

### 07:14 Arabic retained action proof and proposal review
- Added Arabic exact-reason unknown rejection recreation test with actual fonts and RTL pixels. Visually inspected retained reason, readable warning, disabled Confirm and visible Cancel. Installed process restart remains untested.
- Proposal47 independently rejected for status-derived settlement completion. Two migrated-schema SQL probes reproduced stable-key timestamp replay conflict and old completed settlement becoming pending during later failed settlement. Diagnostic patch/probes transferred to parent, then removed from active tree.
- Proposal48 under review only, not Flutter-wired: four migrated-schema PGlite probes pass stable replay/actor/alias, return-only immutable completion during later failure, trigger-injected marker atomic rollback, keyed settlement approval. Mock stock-document bridge, no native/concurrency/crash claim. Concurrent approval and intermediate configured-chain exact-key gaps remain routed to backend. Durable unknown UI block unchanged.

### 07:28 reconciliation proposals 49/50 independent gate
- 49 was rejected: changed reason/expected level silently replayed; committed decision falsely implied endpoint completion after a trigger-failed transfer transition; earlier-level replay could take final approver provenance; native overlapping distinct-key settlement approval failed action VARCHAR(24). Diagnostic tests reproduced all four, parent notified.
- 50 under review fixes tested cases. Four independent PGlite cases qualify actor/reason/level/policy/round conflicts and trigger-failed reject/return/final-approve boundaries. Original final key resumes; earlier key cannot claim final provenance.
- Native PostgreSQL14.25 independent-client harness qualifies immutable completion vs later pending, same/distinct-key settlement approval overlaps, and configured-chain decision unique-key races. One increment and truthful applied-vs-already result. DB sleep trigger forces approval-decision insert overlap.
- Nest HTTP actual controller and production PermissionsGuard plus fixture authentication: missing fixture auth401, permission403, branch404, hidden warehouse403, company404, invalidkey/alias400, mismatched alias ABSENT, no hash/cost disclosure. JWT verification not qualified here. Stock-document bridge mocked, so no stock movement/process crash/installed restart claim. Isolated cluster stopped after tests.
- No UI wiring yet. Legacy submit REVIEWED alias and safe terminal semantics for legitimate intermediate decisions remain routed to backend. Unknown/PENDING/ABSENT/REVIEW never mean no-op and never cause replay. Exact operation proof must be distinct from DECISION_ONLY.

### 07:32 HTTP refusal is not no-effect proof
- Removed own overbroad detail-action 4xx definitive classification. Multistage actions can return 400/409 after reservation, decision or stock side effects; HTTP code alone cannot erase original identity or permit fresh-key retry.
- All failed detail writes now retain original durable key/input and block until authoritative reconciliation. Updated400 receive test qualifies retained1.25 through provider recreation, disabled fields/Confirm and exactly one request.15 dedicated widgets and full analyze pass. Inspected refreshed settlement pixels: warning readable, inputs retained, submission disabled.
- Proposal51 rejected by independent migrated-schema trigger test: adding a policy level after failed final transition converted unresolved chief key to ACCEPTED_STEP. Immutable decision-time endpoint terminality evidence needed. No proposal UI unlock wired.

### 07:39 exact request read reconciliation checkpoint52
- Frozen decision-time completesChain replaces unsafe live-policy inference. Six independent PGlite cases pass actor/reason/level/policy/round fingerprint conflicts, failed reject/return/final transfer transitions, correct final actor resume, policy addition/removal and historical-round read semantics. Older NULL decision terminality stays unknown.
- NativePG14 fresh schema: independent-client same/distinct settlement approval and configured-chain decision overlap plus actual HTTP controller/production permission guard read boundaries pass. Stock-document bridge remains mocked; fixture authentication is not JWT verification. Cluster stopped. tsc clean.
- Flutter now queries read-only exact action/key outcome. COMPLETED original operation, frozen ACCEPTED_STEP (worded only as recorded approval step), and ALREADY_APPROVED/applied=false have distinct recovery messages. Refetch details after proof before unlocking, so initial stale quantities cannot drive next action. Unknown, absent, pending, review, decision-only terminal pending, wrong key and wrong action stay durably blocked. No automatic POST replay.
-24 dedicated widgets pass plus analyze; eight gate variants and explicit unapplied settlement race proof added, provider recreation preserved. Accepted-step actual-font pixels inspected, full warning readable and no claim of whole transfer approval. Installed process restart/native stock bridge not tested here. Partial control register unchanged138/53.
- Nonfinal replay notification side effect separately inspected: same company/dedupeKey upsert, repeat interval/audience-change can reopen existing row; not side-effect-free replay and UI never replays it.

### 07:43 transit report controls
- Qualified report open/close with45 synthetic rows, vertical scroll to last row and no write requests. Added missing vertical report scroll; prior only horizontal frame could overflow tall tables. Replaced raw report/details-open exception Snackbar with safe acknowledged error dialog.
- Actual-font report pixels inspected at end of scroll: rows27-44 readable, Close visible. Synthetic report values only, not backend totals verification.
-25 dedicated widgets and analyze pass. Partial source-site register now140 mapped/51 open after report trigger and Close mapping; unchanged191 denominator and no full-product coverage claim. Optional worker53 simulated tests skipped as less decisive than own existing trigger tests, no source required.

### 07:50 expiry navigation routes
- Three new synthetic feed + GoRouter tests tap Notification centre, lot row and expired Write off route. Exact destination paths checked, no scan requested. These qualify navigation only, not destination screens or write-off execution.
- Partial register143mapped/48open of original191 sites. No production UI change or visual claim in this navigation-only batch. Full expiry suite and analyze checked locally, no CI/install claim.

### 08:02 count warehouse and notes controls
- New exact-payload widget selects second warehouse and notes, proves FULL count payload preserves chosen warehouse and trimmed notes. Successful path only; source-site mapping does not imply error/restart retention.
- Newly found create-count gap routed to parent: dialog closes before request so refusal loses input; server open endpoint has no create idempotency key, so naive retained retry after lost response could duplicate frozen sessions. No unsafe retry patch made; backend exact-key contract requested.
- Partial register145mapped/46open of191. Full stock-take widget suite and analyze checked. No SQL, installed or CI proof implied.

### 08:11 count-create exact identity and retained draft54
- Integrated optional backend create key with same-transaction session/frozen rows/number/hash and actor/company uniqueness. Two own PGlite probes qualify frozen replay vs later receipt, normalized intent/conflict/minimal scoped read and trigger-injected key failure rolling back session/lines/sequence.
- NativePG14 fresh migration independent-client same-key twins both return one session, different intent twin conflicts with one session. Actual HTTP header, ValidationPipe DTO and production PermissionsGuard qualify exact read after ignored response,409 conflict,400DTO,401fixture auth,other actor ABSENT,warehouse403,branchABSENT,permission403 and minimal result. No JWT verification or installed restart claim. Cluster stopped; tsc clean.
- Flutter saves minimal create key/input durably before send scoped API/user/company, retains selected warehouse/scope/items/notes on all failures and blocks duplicate after provider recreation. Exact completed own key/warehouse/session read opens original, ABSENT/unverifiable retains block. Never automatically replays POST. Dialog route completion awaited before disposing field controller.
-28 stock-take widgets/analyze pass. Actual-font retained draft pixels inspected: full warning and disabled Open count readable. Partial source register remains145/46; no new count inflation. Real installed-process restart still untested.

### 08:12 Arabic missing-option recovery qualification
- Additional Arabic RTL count-create test qualifies actual-font retained Arabic notes, saved unavailable warehouse label and disabled submission after provider recreation. Wrong warehouse in completed proof cannot clear original uncertainty; exactly one POST remains. Exact matching completion is covered by prior English test.
- Actual pixels inspected: readable Arabic warning, retained notes and missing-warehouse label, disabled Open count and visible Cancel. Focused test and analyze pass; no production logic change in this checkpoint. Installed-process restart remains untested.

### 08:24 count detail action controls
- Two own widget cases tap actual detail Approve/Post callbacks (distinct from already-tested list toolbar), cancel sends nothing, confirm targets exact session endpoint. Synthetic response only, no SQL/stock/idempotency/restart proof implied.
- Partial register147mapped/44open of191. Focused2/2 and analyze pass. No production logic changes in this batch.
