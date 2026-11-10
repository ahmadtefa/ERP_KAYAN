// Static verification of the complete-removal script's safety rules. The script
// itself needs Windows to run; these tests read the source and pin the promises
// that must never be quietly weakened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../distribution/windows/remove-everything.ps1', import.meta.url), 'utf8');
const installer = readFileSync(
  new URL('../distribution/windows/installer.iss', import.meta.url), 'utf8');

test('nothing is deleted without an explicit confirmation switch', () => {
  assert.match(source, /\[switch\]\$ConfirmRemoval/);
  // The guard must be a real branch on the switch, and it must sit before every
  // deletion. Matching the text alone would pass on a comment or a dead branch.
  const guard = source.match(/if\s*\(\s*-not\s+\$ConfirmRemoval\s*\)/);
  assert.ok(guard, 'the confirmation guard must test the switch itself');
  const guardAt = source.search(/if\s*\(\s*-not\s+\$ConfirmRemoval\s*\)/);
  // The first *call* to a removal function, at the start of a line - not its
  // definition, which sits above the guard.
  const firstDelete = source.search(/^Remove-KayanService$/m);
  assert.ok(firstDelete > 0, 'the main sequence must exist');
  assert.ok(guardAt < firstDelete, 'the guard must run before anything is removed');
  // The refusal must exit non-zero and say that nothing was deleted.
  assert.match(source, /Refusing to remove anything without -ConfirmRemoval/);
  assert.match(source, /Nothing was deleted/);
});

test('a plan can be produced without deleting anything', () => {
  assert.match(source, /\[switch\]\$WhatIfPlan/);
  const planBranch = source.slice(source.indexOf('if ($WhatIfPlan)'), source.indexOf('if (-not $ConfirmRemoval)'));
  assert.doesNotMatch(planBranch, /Remove-Item/);
});

test('ownership is proven before a folder is removed', () => {
  assert.match(source, /function Test-KayanOwnedFolder/);
  assert.match(source, /function Test-UnderRoot/);
  // Remove-KayanFolder must consult the ownership check and skip when it fails.
  const fn = source.slice(source.indexOf('function Remove-KayanFolder'), source.indexOf('function Get-KayanInstallRoot'));
  assert.match(fn, /Test-KayanOwnedFolder/);
  assert.match(fn, /has no KAYAN marker; left alone/);
});

test('the database folder must be identifiable as PostgreSQL', () => {
  assert.match(source, /PG_VERSION/);
  assert.match(source, /is not a PostgreSQL data directory/);
});

test('the install location comes from the registry, not a fixed guess', () => {
  assert.match(source, /Uninstall\\\*/);
  assert.match(source, /InstallLocation/);
});

test('every component in the requirement is handled', () => {
  for (const marker of [
    'KayanERPPostgreSQL',        // the service
    'AppData\\Roaming\\KAYAN-ERP', // per-user settings
    'AppData\\Local\\KAYAN-ERP',   // per-user cache
    'Uninstall\\KAYAN ERP_is1',    // registry entry
    'Get-ScheduledTask',           // scheduled tasks
    'Start Menu',                  // shortcuts
  ]) {
    assert.ok(source.includes(marker), `complete removal must handle: ${marker}`);
  }
});

test('success is never claimed while anything remains', () => {
  assert.match(source, /function Assert-NothingLeft/);
  assert.match(source, /complete       = \(\$script:Failures\.Count -eq 0 -and \$Remaining\.Count -eq 0\)/);
  assert.match(source, /did not finish/);
  assert.match(source, /exit 1/);
});

test('a failure report names the path and the reason', () => {
  const failureWrites = source.match(/component = '[^']+'; path = [^;]+; reason = [^}]+/g) ?? [];
  assert.ok(failureWrites.length >= 4, 'each deletion path must record path and reason');
});

test('normal uninstall is a different script and keeps company data', () => {
  const normal = readFileSync(
    new URL('../distribution/windows/remove-runtime.ps1', import.meta.url), 'utf8');
  assert.match(normal, /Database data retained/);
  assert.doesNotMatch(normal, /Remove-Item[^\n]*PostgreSQL/);
  // The ordinary route does not call the destructive script.
  assert.doesNotMatch(normal, /remove-everything/);
});

test('complete removal is unreachable from the ordinary uninstall', () => {
  // InitializeUninstall only reaches RemoveEverything through the explicit
  // switch, which the ordinary dialog never supplies.
  const init = installer.slice(installer.indexOf('function InitializeUninstall'));
  assert.match(init, /CmdLineParamExists\('\/REMOVEEVERYTHING'\)/);
  assert.match(installer, /Parameters: "\/REMOVEEVERYTHING"/);
  // The ordinary path still runs remove-runtime.ps1, from its own function.
  const keepData = installer.slice(installer.indexOf('function RemoveProgramKeepData'), installer.indexOf('function RemoveEverything'));
  assert.match(keepData, /remove-runtime\.ps1/);
  // ...and that route never mentions the destructive script.
  assert.doesNotMatch(keepData, /remove-everything/);
  assert.match(init, /RemoveProgramKeepData\(\)/);
});

test('two confirmations, both explicit, before data is destroyed', () => {
  const fn = installer.slice(installer.indexOf('function RemoveEverything'), installer.indexOf('function InitializeUninstall'));
  // Only constants Inno Setup actually defines count. The old pattern accepted
  // `mbWarning`, which does not exist: it let the guard pass locally while the
  // real compiler refused the file, so a build that looked reviewed could never
  // produce a Setup. A confirmation that cannot compile confirms nothing.
  const confirmations = fn.match(/(?:mbError|mbConfirmation|mbCriticalError), MB_YESNO/g) ?? [];
  assert.equal(confirmations.length, 2, 'complete removal needs two separate confirmations');
  assert.doesNotMatch(fn, /mbWarning/, 'mbWarning is not an Inno Setup constant; it cannot compile');
  assert.match(fn, /This cannot be undone/);
});

test('processes and the service are stopped before files are deleted', () => {
  const main = source.slice(source.indexOf('Stop-KayanProcesses\nRemove-KayanService'));
  assert.ok(main.indexOf('Stop-KayanProcesses') < main.indexOf('Remove-KayanFolder'));
  assert.ok(source.includes('Stop-Service -Name $serviceName -Force'));
});

test('logs can be kept for diagnosis without blocking the removal', () => {
  assert.match(source, /\[switch\]\$KeepLogs/);
  assert.match(source, /Copy-Item -LiteralPath \$LogDirectory/);
});
