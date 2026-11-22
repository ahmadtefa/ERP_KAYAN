// Regression guard for the bundled Windows repair path.
//
// Background: commit 3dc6b84 replaced two `if (...)` guards in
// repair-runtime.ps1 with bare `{ ... }` blocks. In PowerShell a bare block is
// a script block literal: it parses, it produces no error, and it never runs.
// Repair therefore skipped the migration verification and the API health probe
// while still printing "repaired successfully", and the SyntaxOnly parser check
// added by f6ae459 passed happily.
//
// These tests fail on that exact shape, and they are plain Node so they run on
// every CI runner without a PowerShell host.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  analysePowerShell,
  analysePowerShellFile,
  findStatement,
} from './powershell-structure.mjs';

const WINDOWS_DIR = fileURLToPath(new URL('../distribution/windows/', import.meta.url));
const REPAIR = join(WINDOWS_DIR, 'repair-runtime.ps1');
const repairSource = readFileSync(REPAIR, 'utf8');

// ---------------------------------------------------------------- analyser

test('the analyser reproduces the 3dc6b84 defect on synthetic input', () => {
  const defective = [
    'try {',
    '  $backendDir = "/app/backend"',
    '  if ((Test-Path $nodeExe) -and (Test-Path $prepareScript)) {',
    '    Start-Process $nodeExe',
    '  }',
    '  {',
    '    $orphaned = 1',
    '  }',
    '} catch { }',
  ].join('\n');

  const result = analysePowerShell(defective, { fileName: 'synthetic.ps1' });
  assert.equal(result.orphanBlocks.length, 1, 'a bare block must be reported');
  assert.equal(result.orphanBlocks[0].line, 6);
});

test('the analyser accepts real block owners', () => {
  const legitimate = [
    'foreach ($item in $items) {',
    '  Write-Output $item',
    '}',
    'if ($a -and $b) {',
    '  Write-Output "both"',
    '} else {',
    '  Write-Output "other"',
    '}',
    '$scriptBlock = { Write-Output "value" }',
    'Invoke-Command -ScriptBlock { Write-Output "remote" }',
    'try {',
    '  throw "x"',
    '} catch {',
    '  Write-Output "caught"',
    '} finally {',
    '  Write-Output "done"',
    '}',
    'switch ($mode) {',
    '  "a" { Write-Output "a" }',
    '  default { Write-Output "d" }',
    '}',
  ].join('\n');

  const result = analysePowerShell(legitimate, { fileName: 'legit.ps1' });
  assert.deepEqual(result.orphanBlocks, []);
  assert.deepEqual(result.unclosedBlocks, []);
});

test('the analyser ignores braces inside comments and strings', () => {
  const source = [
    'Write-Output "a { that is only text"',
    "# a { in a comment",
    "<# a { in a block comment #>",
    "# $x = { script block in a comment }",
    "$here = @'",
    '{ not a real block',
    "'@",
    'Write-Output "done"',
  ].join('\n');

  const result = analysePowerShell(source, { fileName: 'text.ps1' });
  assert.deepEqual(result.orphanBlocks, []);
  assert.deepEqual(result.unclosedBlocks, []);
});

// ------------------------------------------------- real bundled scripts

test('every bundled Windows PowerShell script is structurally sound', () => {
  const files = readdirSync(WINDOWS_DIR).filter((name) => name.endsWith('.ps1'));
  assert.ok(files.length >= 7, `expected the bundled scripts, got ${files.length}`);
  const problems = [];
  for (const name of files) {
    const result = analysePowerShellFile(join(WINDOWS_DIR, name));
    for (const orphan of result.orphanBlocks) {
      problems.push(`${name}:${orphan.line} is a bare { } block that never executes`);
    }
    for (const open of result.unclosedBlocks) {
      problems.push(`${name}:${open.line} opens a block that is never closed`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

// ---------------------------------------------- repair must really verify

test('repair runs the migration verification unconditionally', () => {
  // The command must exist in live code (not only in a comment or string)...
  assert.ok(
    findStatement(repairSource, "'scripts\\prepare-database.mjs'"),
    'repair must invoke prepare-database.mjs',
  );
  assert.ok(
    findStatement(repairSource, 'Database migration verification failed'),
    'repair must fail when the migration check fails',
  );

  // The invariant that makes the guard safe: the required-file precondition
  // throws BEFORE the guarded check, so the guard can never be the reason the
  // migration check is skipped. Without this ordering the old silent-skip
  // behaviour comes straight back.
  const precondition = repairSource.indexOf('foreach ($requiredRuntimeFile in @(');
  const migrationIf = repairSource.indexOf("if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $prepareScript))");
  assert.ok(precondition > 0, 'the required-file precondition must exist');
  assert.ok(migrationIf > precondition, 'the precondition must run before the guarded migration check');
  assert.ok(
    repairSource.slice(precondition, migrationIf).includes('throw'),
    'the precondition must throw, not merely warn',
  );
});

test('repair probes the API health endpoint unconditionally', () => {
  assert.ok(findStatement(repairSource, '/api/v1/health'), 'repair must probe /api/v1/health');
  assert.ok(
    findStatement(repairSource, 'did not answer on 127.0.0.1'),
    'repair must fail when the probe gets no answer',
  );
});

test('repair refuses to succeed on a partial installation', () => {
  for (const required of ['node\\node.exe', 'scripts\\prepare-database.mjs', 'dist\\src\\main.js']) {
    assert.ok(
      findStatement(repairSource, `Join-Path $backendDir '${required}'`),
      `repair must locate ${required}`,
    );
  }
  assert.match(
    repairSource,
    /foreach \(\$requiredRuntimeFile in @\(\$nodeExe, \$prepareScript, \$mainJs\)\)/,
    'repair must check every required runtime file in one loop',
  );
  assert.match(
    repairSource,
    /Repair cannot verify the runtime because a required installed file is missing/,
    'repair must name the missing file and stop',
  );
  assert.match(
    repairSource,
    /if \(-not \(Test-Path -LiteralPath \$requiredRuntimeFile -PathType Leaf\)\) \{\s*\n\s*throw/,
    'a missing runtime file must throw before any verification runs',
  );
});

test('repair has no switch that can skip verification', () => {
  // A parameter that turns the checks off would be a second way to the old
  // "reports success without verifying" behaviour.
  assert.doesNotMatch(repairSource, /\$Skip(MigrationCheck|HealthProbe|Verification)/i);
  const paramBlock = repairSource.slice(0, repairSource.indexOf('$ErrorActionPreference'));
  assert.doesNotMatch(paramBlock, /\$Skip/i);
});

test('repair still fails closed and still enforces licences', () => {
  assert.match(repairSource, /Write-RepairMarker 'KAYAN-REPAIR-OK'/);
  assert.match(repairSource, /Write-RepairMarker \("KAYAN-REPAIR-FAILED "/);
  assert.match(repairSource, /^\s*exit 1\s*$/m, 'repair must exit non-zero on failure');
  assert.match(repairSource, /KAYAN-REPAIR-LICENCE-ENFORCED/);
  assert.match(
    repairSource,
    /if \(\$health\.license\.enforcement -ne 'enforce'\)/,
    'licence enforcement must still be verified on the running server',
  );
  // The success marker must not be reachable from inside a handler that
  // swallows the failure.
  const okIndex = repairSource.indexOf("Write-RepairMarker 'KAYAN-REPAIR-OK'");
  const exitIndex = repairSource.lastIndexOf('exit 1');
  assert.ok(okIndex > 0 && okIndex < exitIndex, 'success must be marked before the failure handler');
});
