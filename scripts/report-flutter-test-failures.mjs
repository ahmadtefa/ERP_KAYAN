// Summarize Flutter's JSON test events as an Actions annotation. The log stays
// in runner temp; no secrets or application data should be used in CI tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarize(text) {
const lines = text.split(/\r?\n/);
const tests = new Map();
const printed = new Map();
const errors = [];
for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === 'testStart' && event.test) tests.set(event.test.id, event.test.name);
  // Only attach exception output for screenshot tests; other test output may
  // contain synthetic credentials and must not be copied into annotations.
  if (event.type === 'print' && tests.get(event.testID)?.startsWith('screenshot:') &&
      /EXCEPTION|Error|Exception|Unable to|golden/i.test(event.message ?? '')) {
    printed.set(event.testID, String(event.message).slice(0, 5000));
  }
  // These three widget tests use only the checked-in synthetic invoice data.
  // Retain assertion counts and test file locations, not arbitrary log output.
  if (event.type === 'print' && /^(an invoice line carries the chosen cost center to the API|without cost centers the line form stays as it was|purchase editor sends multiple named landed-cost charges and their total)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/invoice_(?:cost_center|editor_landed_cost)_test\.dart:\d+:\d+/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // The order-flow widget tests contain only checked-in synthetic IDs and
  // numbers. Report assertion counts and source locations, never payloads.
  if (event.type === 'print' && /^(sales|purchase): (?:uncertain conversion reuses the key and refreshes|order creation preserves an uncertain request across reopening|draft edit retains its exact retry after reopening|approval and cancellation refresh the order|uncertain post refreshes before reversal)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/features\/orders\/order_(?:(?:create_|edit_)?flow|actions)_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|Incorrect use of ParentDataWidget|Cannot hit test a render box that has never been laid out|No Material widget found|RenderFlex overflowed|A Timer is still pending|Multiple exceptions|No ScaffoldMessenger widget found)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  if (event.type === 'print' && /^(an invoice detail retry reloads after a transient error|stock ledger retry reloads after a transient error)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/(?:responsive_tables_test|stock_ledger_retry_test)\.dart:\d+:\d+/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // The voucher load-retry tests contain only checked-in synthetic data.
  // Report assertion counts, source locations and fixed framework diagnostics,
  // never arbitrary exception text or request payloads.
  if (event.type === 'print' && /^(?:(?:list|detail|create|history) voucher load shows a safe acknowledged error and retries|(?:RECEIPT|ISSUE) voucher (?:retains exact request across an uncertain create|draft protects the routed stock screen exit)|voucher detail and selectors use (?:Arabic RTL|English LTR) names)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/stock_voucher_flow_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|Cannot hit test a render box that has never been laid out|RenderFlex overflowed|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions|No ScaffoldMessenger widget found)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // Invoice navigation tests use only checked-in synthetic widget data.
  if (event.type === 'print' && /^(?:sales|purchase) invoice (?:remains guarded when its routed list leaves|unexpected save error is acknowledged without losing inputs)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/invoice_unsaved_guard_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // Synthetic order route tests: only fixed assertion counts and locations.
  if (event.type === 'print' && /^(?:(?:sales|purchase) (?:edit|create) order protects the routed list exit|order action blocks routed and system back until its response)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/features\/orders\/order_route_guard_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  if (event.type === 'print' && /^(?:sales|purchase) (?:post|reverse) refreshes after unexpected action failure$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/invoice_action_refresh_error_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|pumpAndSettle timed out|Multiple exceptions)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // These UI/refresh fixtures contain only synthetic constants. Restrict
  // diagnostics to locations, numeric counts and known framework errors.
  if (event.type === 'print' && /^(?:item tax (?:blank|whitespace|0|7) sends correct value when (?:creating|editing)|item save failure keeps the form and its tax input|both Home buttons preserve a return draft when navigation is cancelled|date picker opens historical and distant future values without changing them|cancel and system back protect text until explicit discard|a changed switch is protected and an unchanged form closes directly|a failed submit keeps the entered fields until a successful retry|uncertain submission preserves the fields and blocks blind retry|year end dialog protects (?:pending and uncertain close|reason on routed navigation)|budget editor protects (?:uncertain save with unavailable selections|routed draft)|fiscal period editor protects (?:uncertain save|routed draft)|cost center (?:deactivation|activation) refreshes after uncertain response|cost center date clear is explicit and uncertain edit retains its draft|cost center draft guards routed navigation|item (?:deactivation|activation) refreshes after uncertain response|item unit (?:edit|create) retains draft and blocks uncertain retry|(?:item|customer|supplier) form preserves a draft on routed navigation|cash account form guards routed exit (?:during submit|with a draft)|cash account creation preserves draft and blocks an uncertain retry|cash transfer retains values and disables retry when POST outcome is unknown|cash balance failure and missing rows never display a false zero|cash (?:receipt|payment) retains fields across lookup and uncertain create|cash (?:Receipts & payments|Transfers) (?:Post|Reverse) refreshes after uncertain response|reset holds the dialog while pending and refuses a blind retry|licence action error is acknowledged without exposing details or clearing input|licence status error is safe and acknowledged before retry|blocked (?:REVOKED|INVALID_STATUS|NOT_YET_VALID) explains the status and preserves backup access|chart initial load follows a newer refresh|chart overlapping refreshes retain latest source response|chart reloads server status after an uncertain status change|journal retains unavailable account on refresh and permits replacement|journal draft guards back and routed navigation|journal (?:post|reverse) refreshes after uncertain response|opening post reloads document and dependent views after uncertain response|voucher workflow refreshes after review approval posting and reversal|(?:sales|purchase) return (?:post|reverse) refreshes after unexpected action failure|(?:customer|supplier) (?:create|edit) keeps input on save failure|(?:customer|supplier) activation failure reloads committed source|sign out asks before discarding a routed return draft|initial result waits for a newer refresh still in flight|a newer refresh error is not hidden by a stale initial result|initial load cannot overwrite a newer successful refresh|an initial load failure cannot replace a newer successful refresh|item picker displays fresh active source after invalidation|(?:sales|purchase) invoice keeps selected party and draft on source refresh|active pickers rebuild from each invalidated source|overlapping refreshes keep the latest result, not the last response|a stale failure does not overwrite a newer successful refresh)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|'(?:draft|posted|reversed|new|old)'|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/(?:widget\/(?:item_blank_tax|item_picker_refresh|party_save_failure|form_sheet_unsaved|return_unsaved_guard|return_action_refresh_error|opening_balance_post_refresh|stock_voucher_flow|journal_refresh_and_unsaved|reset_data_card|cash_action_refresh_error|cash_creation_uncertain|cash_balance_failure|cash_voucher_creation|cash_route_guard|master_data_route_guard|item_unit_save_failure|item_status_refresh|cost_center_draft|cost_center_status_refresh|fiscal_period_draft|budget_draft|year_end_close_guard|invoice_unsaved_guard)_test|features\/(?:common\/resource_refresh_race|accounting\/chart_refresh_race|licensing\/(?:licence_status_gate|licence_screen_errors))_test)\.dart:\d+:\d+/)?.[0] ??
      line.match(/lib\/shared\/widgets\/(?:item_picker_dialog|resizable_table|state_views)\.dart:\d+:\d+/)?.[0] ??
      line.match(/A RenderFlex overflowed by [0-9.]+ pixels on the (?:left|right|top|bottom)/)?.[0] ??
      line.match(/The overflowing RenderFlex has an orientation of Axis\.(?:vertical|horizontal)/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|Cannot hit test a render box that has never been laid out|RenderFlex overflowed|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions|No Material widget found|No ScaffoldMessenger widget found|No Scaffold widget found)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // The following widget tests contain synthetic data only. Preserve fixed
  // framework diagnostics, assertion counts and source locations, never
  // arbitrary error messages, image bytes or application payloads.
  if (event.type === 'print' && /^(?:photo refreshes after upload and delete commit with lost responses|routed chart navigation (?:preserves or discards its open draft|waits for a pending save)|long parent account names fit the editor and retain the selected parent|an uncertain save preserves the draft and refuses blind retry|different concurrent errors are acknowledged in order|(?:sales|purchase): tax edit validates (?:0|7|101|-1)|successful invoice posting refreshes previously cached reports)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/(?:widget\/(?:user_photo|chart_of_accounts_interaction|app_error_dialog_lifecycle|invoice_action_refresh_error)|features\/orders\/order_edit_flow)_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions|RenderFlex overflowed|No ScaffoldMessenger widget found)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // Asset tests use checked-in synthetic fixtures. Only fixed diagnostics,
  // assertion counts and file positions are eligible for annotations.
  if (event.type === 'print' && /^(?:lost disposal response preserves proceeds and blocks a second request|lost depreciation response preserves period and blocks a second request)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|null|not null|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/fixed_assets_screen_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|Cannot hit test a render box that has never been laid out|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions|RenderFlex overflowed|No ScaffoldMessenger widget found)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // Administration widget fixtures contain no real credentials. Emit only
  // fixed framework failures, numeric assertion counts and source positions.
  if (event.type === 'print' && /^(?:user edits preserve assigned and unavailable roles|user can explicitly remove an unavailable assigned role|uncertain user edit retains draft and refreshes list|user editor fails safely for (?:incomplete user roles|unavailable roles catalogue)|user creation and password change inputs obscure sensitive text|uncertain role creation retains fields without blind retry|(?:role|extra user) permission editing preserves checked grants|unchanged permissions are not sent over newer server grants|malformed permission sources never save an empty grant list|malformed permission catalogue disables save|permissions draft guards route navigation|user draft guards route navigation|admin status refreshes after a lost deactivation response|role deletion refreshes after a lost response|admin action blocks routed exit until it finishes)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|null|not null|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/admin_draft_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|Cannot hit test a render box that has never been laid out|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions|RenderFlex overflowed|No ScaffoldMessenger widget found)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  // The backup deletion-protection widget uses synthetic file names only.
  // Emit assertion counts and fixed framework diagnostics, never response data.
  if (event.type === 'print' && ['protected backups show why deletion is unavailable', 'unverified restore options are hidden in en, capability false', 'unverified restore options are hidden in en, capability null', 'unverified restore options are hidden in ar, capability false', 'unverified restore options are hidden in ar, capability null', 'failed capability refresh hides previously offered restore'].includes(tests.get(event.testID))) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|null|not null|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/full_backup_section_test\.dart:\d+:\d+/)?.[0] ??
      line.match(/(?:Bad state: No element|Bad state: Too many elements|Cannot hit test a render box that has never been laid out|pumpAndSettle timed out|A Timer is still pending|Multiple exceptions|RenderFlex overflowed|No ScaffoldMessenger widget found)/)?.[0] ??
      line.match(/A RenderFlex overflowed by [0-9.]+ pixels on the (?:left|right|top|bottom)/)?.[0] ??
      line.match(/^The following [A-Za-z]+ (?:was thrown|object was thrown).*$/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  if (event.type === 'error') {
    const message = `${tests.get(event.testID) ?? `test ${event.testID ?? 'unknown'}`}: ${event.error ?? 'unknown error'} ${event.stackTrace ?? ''} ${printed.get(event.testID) ?? ''}`;
    if (tests.get(event.testID)?.startsWith('screenshot:')) errors.push(message);
    else errors.unshift(message);
  }
}
const message = (errors.length ? errors.slice(0, 12).join(' | ') : lines.slice(-35).join(' | '))
  .replace(/postgres(?:ql)?:\/\/[^\s'"@]*@/gi, 'postgresql://[redacted]@')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
  .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
  .slice(0, 45000).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
return message || 'No diagnostic was captured.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Expected a Flutter test log path.');
  console.log(`::error title=Flutter test failures::${summarize(readFileSync(path, 'utf8'))}`);
}
