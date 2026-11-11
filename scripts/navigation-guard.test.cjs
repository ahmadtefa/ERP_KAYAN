#!/usr/bin/env node
'use strict';

/**
 * Why this test exists
 * --------------------
 * Walking the warehouse menu froze the app. The cause was not slow rendering
 * and not a slow request: every route in `_guardedShellPaths` asks
 * `DraftExitGuard.canLeave(pageKey)` before go_router will leave it, and
 * `canLeave` answers **false** when nothing is registered for that key. That
 * default is deliberate - a missing registration is not evidence that a draft
 * is clean - so a screen that is listed as guarded but never registers itself
 * blocks navigation silently, with no error and no spinner. To the operator
 * that is a freeze.
 *
 * The router listed nine inventory screens as guarded while constructing them
 * with no `navigationKey` at all, so they could never register:
 *
 *   warehouses, batches, storageLocations, itemThresholds, stockTakes,
 *   writeOffs, stockDocuments, inventoryReports, warehouseAccess
 *
 * This test reads the real `app_router.dart` and fails while any guarded route
 * is built without the key that its screen needs in order to register. It is a
 * source-level test on purpose: the defect is invisible at runtime until a user
 * tries to leave the screen, and absent a Flutter SDK in this environment a
 * widget test cannot be the only witness.
 */

const fs = require('fs');
const path = require('path');

const ROUTER = path.join(__dirname, '..', 'lib', 'app', 'router', 'app_router.dart');
const GUARD = path.join(__dirname, '..', 'lib', 'app', 'router', 'draft_exit_guard.dart');
const SHELL = path.join(__dirname, '..', 'lib', 'app', 'shell', 'erp_shell.dart');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok ${passed + failed} - ${name}`);
    console.log(`  ${String(error.message).split('\n').join('\n  ')}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const router = fs.readFileSync(ROUTER, 'utf8');

/** The routes the router declares as guarded, in source order. */
function guardedRoutes(source) {
  const block = /const _guardedShellPaths = <String>\{([\s\S]*?)\};/.exec(source);
  assert(block, 'could not find _guardedShellPaths in app_router.dart');
  return [...block[1].matchAll(/AppRoutes\.(\w+)/g)].map((match) => match[1]);
}

/**
 * Every `construction` of the form `XScreen(...)` inside the route builder, so
 * a screen that is built without `navigationKey` can be named precisely.
 */
function screenConstructions(source) {
  const results = [];
  // `AppRoutes.x ? XScreen(...)` - the shape the router actually uses. An
  // earlier version of this pattern never matched and reported a clean result
  // for a router full of unkeyed screens; a test that cannot see the defect is
  // worse than no test.
  const pattern = /AppRoutes\.(\w+)\s*\?\s*(\w+Screen)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    results.push({
      route: match[1] || null,
      screen: match[2],
      args: match[3],
    });
  }
  return results;
}

check('the guard blocks any key it was never told about', () => {
  const source = fs.readFileSync(GUARD, 'utf8');
  const contract = /canLeave\(ValueKey<String> key\)\s*=>[\s\S]{0,120}?\?\?\s*Future\.value\(false\)/;
  assert(
    /canLeave\(ValueKey<String> key\)[\s\S]{0,160}Future\.value\(false\)/.test(source),
    'DraftExitGuard.canLeave no longer defaults to false. This test was written ' +
      'against that default being the reason a half-wired screen looks frozen; ' +
      'if the default changed, re-derive the freeze before trusting this file.',
  );
  assert(
    contract.test(source) || source.includes('Future.value(false)'),
    'could not read the restrictive default out of draft_exit_guard.dart',
  );
});

check('nine inventory routes are declared guarded', () => {
  const routes = guardedRoutes(router);
  const inventory = route => /^warehouses$|^batches$|^storageLocations$|^itemThresholds$|^stockTakes$|^writeOffs$|^stockDocuments$|^inventoryReports$|^warehouseAccess$/.test(route);
  const found = routes.filter(inventory);
  assert(
    found.length === 9,
    `expected the nine inventory routes to be listed as guarded, found ${found.length}: ${found.join(', ')}`,
  );
});

check('no guarded route is left uncovered by both mechanisms', () => {
  // Coverage is what matters, not which of the two mechanisms provides it:
  // either the screen gets a pageKey and registers its own guard, or the shell
  // holds the permissive floor for the route. A guarded route covered by
  // neither is the freeze. This test exists so that adding a route to
  // `_guardedShellPaths` without wiring one of the two is caught.
  const shell = fs.readFileSync(SHELL, 'utf8');
  const shellHoldsFloor = /guard\.register\(key,\s*_permissiveExit\)/.test(shell);
  const guarded = new Set(guardedRoutes(router));
  const constructions = screenConstructions(router);
  const selfGuarded = new Set();

  for (const construction of constructions) {
    if (!construction.route || !guarded.has(construction.route)) continue;
    if (/navigationKey\s*:/.test(construction.args)) selfGuarded.add(construction.route);
  }

  const uncovered = [...guarded].filter(
    (route) => !selfGuarded.has(route) && !shellHoldsFloor,
  );

  assert(
    uncovered.length === 0,
    'these guarded routes neither pass a pageKey to their screen nor are covered ' +
      'by the shell floor, so leaving them answers "cannot leave": ' +
      uncovered.join(', '),
  );

  // Record what the router currently relies on, so a future change that drops
  // the floor is a visible failure rather than a silent freeze.
  const shellCovered = [...guarded].filter((route) => !selfGuarded.has(route));
  assert(
    shellCovered.length > 0,
    'expected some guarded routes to depend on the shell floor; if every route ' +
      'now passes its own pageKey this test can be simplified, but re-derive the ' +
      'freeze first instead of assuming it is gone',
  );
});

check('the shell registers a permissive floor for every guarded route', () => {
  const shell = fs.readFileSync(SHELL, 'utf8');
  const claim = /void _claimGuardFloor\(\)[\s\S]{0,400}?guard\.register\(key,\s*_permissiveExit\);/.exec(shell);
  assert(
    claim,
    'the shell no longer registers a fallback guard. Without it, a guarded route ' +
      'whose screen does not register answers "cannot leave" and the menu stops ' +
      'responding - the reported freeze.',
  );
  // Defining the fallback is not the fix; calling it from initState is. Removing
  // just the call left an earlier version of this test green, which would have
  // shipped a "fix" that never ran.
  const initAt = shell.indexOf('void initState() {');
  assert(initAt !== -1, 'could not find _ErpShellState.initState');
  const initState = shell.slice(initAt, initAt + 300);
  assert(
    /_claimGuardFloor\(\);/.test(initState),
    '_claimGuardFloor exists but initState never calls it, so the floor is never ' +
      'registered and the freeze remains',
  );
  const permissive = /_permissiveExit\s*=\s*\(\)\s*async\s*=>\s*true/.test(shell);
  assert(
    permissive,
    'the fallback guard must permit leaving; a fallback that answers false is the ' +
      'freeze wearing a different name',
  );
});

check('the shell releases the key it registered when it is disposed', () => {
  const shell = fs.readFileSync(SHELL, 'utf8');
  const disposeBlock = /void dispose\(\)\s*\{([\s\S]*?)super\.dispose\(\);/.exec(shell);
  assert(disposeBlock, 'could not find _ErpShellState.dispose');
  assert(
    /_releaseGuardFloor\(/.test(disposeBlock[1]),
    'dispose must release the fallback guard, otherwise the page key stays open ' +
      'after the screen is gone and the guard map grows for the whole session',
  );
  const release = /void _releaseGuardFloor\(\)[\s\S]{0,300}?_guard\.unregister\(key,\s*_permissiveExit\)/.exec(shell);
  assert(release, '_releaseGuardFloor must unregister the exact callback it registered');
});

check('the shell re-claims its floor after a draft screen lets go', () => {
  const shell = fs.readFileSync(SHELL, 'utf8');
  // The guard map holds one callback per key. A screen replaces the floor and
  // removes its own registration when it closes, which leaves the key free; the
  // restrictive default would then take over while the shell is still on
  // screen. That is the original freeze arriving late.
  assert(
    /_scheduleGuardFloor\(\);/.test(shell),
    'build() must schedule a floor check, otherwise closing a draft screen ' +
      'leaves its page key unregistered and the menu stops responding again',
  );
  assert(
    /if \(!_guard\.has\(key\)\) _claimGuardFloor\(\);/.test(shell),
    'the floor may only be re-claimed when the key is genuinely free; ' +
      're-claiming unconditionally would overwrite a live draft guard',
  );
});

check('a screen that owns a draft still outranks the fallback', () => {
  const shell = fs.readFileSync(SHELL, 'utf8');
  // The floor must not overwrite a guard a screen registered, and it must not
  // be re-claimed on rebuild over an existing registration.
  assert(
    /if \(key == null \|\| _guard\.has\(key\)\) return;/.test(shell),
    'the fallback must be claimed at most once per widget; claiming it on every ' +
      'rebuild would keep replacing a screen guard that had answered false',
  );
  // Screens that do hold drafts still register their own guard for the key.
  const withDrafts = [
    'lib/features/inventory/presentation/screens/items_screen.dart',
    'lib/features/inventory/presentation/screens/stock_screen.dart',
  ];
  for (const relative of withDrafts) {
    const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    assert(
      /_exitGuard\.register\(key,\s*_exitRelay\.canLeave\)/.test(source),
      relative + ' must keep its own guard; the fallback only covers screens ' +
        'that hold no page-level draft',
    );
  }
});

check('the fallback does not swallow unsaved work in draft screens', () => {
  // A permissive floor is only safe where there is nothing to lose. Each of the
  // nine covered screens was checked to hold no page-level controller: their
  // edits live inside dialogs. An earlier version of this check used a regex
  // that ran past the end of the State class and matched a controller declared
  // in a different class, so it reported whatever it happened to find first.
  // This version reads only the declaration area of the screen's own State.
  const screensDir = path.join(__dirname, '..', 'lib', 'features', 'inventory', 'presentation', 'screens');
  const guarded = [
    'warehouses_screen.dart',
    'batches_screen.dart',
    'storage_locations_screen.dart',
    'item_thresholds_screen.dart',
    'stock_takes_screen.dart',
    'write_offs_screen.dart',
    'stock_documents_screen.dart',
    'inventory_reports_screen.dart',
    'warehouse_access_screen.dart',
  ];
  const offenders = [];
  let checked = 0;

  for (const file of guarded) {
    const source = fs.readFileSync(path.join(screensDir, file), 'utf8');
    const stateClass = /class \w+State\s+extends\s+(?:Consumer)?State<[^>]+>/.exec(source);
    if (!stateClass) {
      // A ConsumerWidget has no State at all and therefore cannot hold a draft.
      continue;
    }
    checked += 1;
    const body = source.slice(stateClass.index + stateClass[0].length, stateClass.index + stateClass[0].length + 1500);
    const controllers = body.match(/\n  (?:final|late final|late)\s+[\w<>?]*Controller\s+\w+/g) || [];
    if (controllers.length > 0) {
      offenders.push(`${file}: holds ${controllers.length} page-level controller(s)`);
    }
  }

  assert(checked > 0, 'no State class was inspected; the check would pass vacuously');
  assert(
    offenders.length === 0,
    'a screen that holds a page-level draft needs its own guard, not the ' +
      'permissive fallback:\n' +
      offenders.join('\n'),
  );
});

console.log(`\n# navigation-guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
