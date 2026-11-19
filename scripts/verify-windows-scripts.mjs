#!/usr/bin/env node
// Semantic check for the bundled Windows PowerShell scripts.
//
// This is the check the syntax-only Parser step could not do. A bare `{ }`
// block is valid PowerShell and is simply never executed, so a repair path can
// lose its migration verification and its health probe while every syntax
// check stays green. Here we detect that shape, plus unclosed blocks, and we
// require the verification steps the repair path exists to perform.
//
// Exit code 0 = every bundled script is structurally sound and complete.
// Exit code 1 = a defect was found (details on stderr).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysePowerShell, findStatement } from './powershell-structure.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, 'distribution/windows');

const problems = [];

const files = readdirSync(directory)
  .filter((name) => name.toLowerCase().endsWith('.ps1'))
  .sort();

if (files.length === 0) {
  console.error('No bundled Windows PowerShell scripts were found.');
  process.exit(1);
}

for (const name of files) {
  const path = join(directory, name);
  const source = readFileSync(path, 'utf8');
  const shown = relative(root, path);
  const result = analysePowerShell(source, { fileName: shown });

  for (const orphan of result.orphanBlocks) {
    problems.push(
      `${shown}:${orphan.line}: bare { } block is never executed ` +
        `(it is a script block literal, not a statement body). ` +
        `Nothing consumes it; line before: ${orphan.evidence || '(start of file)'}`,
    );
  }
  for (const open of result.unclosedBlocks) {
    problems.push(`${shown}:${open.line}: block opened at line ${open.line} is never closed`);
  }
}

// The repair path must keep the checks it exists for. Missing steps and
// disabled steps are both failures.
const repairPath = join(directory, 'repair-runtime.ps1');
const repair = readFileSync(repairPath, 'utf8');

const requiredRepairSteps = [
  { matcher: "'scripts\\prepare-database.mjs'", label: 'runs prepare-database.mjs (migration verification)' },
  { matcher: '/api/v1/health', label: 'probes the API /api/v1/health endpoint' },
  { matcher: 'KAYAN-REPAIR-LICENCE-ENFORCED', label: 'verifies licence enforcement survived repair' },
];

for (const step of requiredRepairSteps) {
  if (!findStatement(repair, step.matcher)) {
    problems.push(`distribution/windows/repair-runtime.ps1: no longer ${step.label}`);
  }
}

if (!/Write-RepairMarker 'KAYAN-REPAIR-OK'/.test(repair)) {
  problems.push('distribution/windows/repair-runtime.ps1: the success marker is missing');
}
if (!/Write-RepairMarker \("KAYAN-REPAIR-FAILED "/.test(repair)) {
  problems.push('distribution/windows/repair-runtime.ps1: the failure marker is missing');
}
if (!/^\s*exit 1\s*$/m.test(repair)) {
  problems.push('distribution/windows/repair-runtime.ps1: a failure no longer exits non-zero');
}
if (/\$Skip(MigrationCheck|HealthProbe|Verification)/i.test(repair)) {
  problems.push('distribution/windows/repair-runtime.ps1: a switch can skip verification');
}

if (problems.length > 0) {
  console.error(`Windows PowerShell semantic check failed (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Windows PowerShell semantic check passed for ${files.length} bundled scripts ` +
    `(no orphaned blocks, repair verification intact).`,
);
