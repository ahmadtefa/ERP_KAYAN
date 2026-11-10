// Guards the Inno Setup [Code] section against identifiers the compiler rejects.
//
// Why this exists: `mbWarning` was written where Inno Setup only defines
// mbInformation, mbConfirmation, mbError and mbCriticalError. Nothing local
// caught it. The PowerShell semantic check reads .ps1 files, the payload tests
// read the file list, and no test parsed the [Code] section at all. It surfaced
// only when a real Windows runner compiled the installer, after thirteen
// minutes of building, and the whole Setup was lost.
//
// A compile error is a total failure, so this checks the cheap thing that would
// have caught it: every Inno constant used in [Code] must be one Inno defines.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'distribution/windows/installer.iss'), 'utf8');

// TMsgBoxType, per Inno Setup's Pascal Script support unit.
const messageBoxTypes = new Set(['mbInformation', 'mbConfirmation', 'mbError', 'mbCriticalError']);
// TMsgBoxButtons, likewise.
const messageBoxButtons = new Set(['MB_OK', 'MB_OKCANCEL', 'MB_ABORTRETRYIGNORE', 'MB_YESNOCANCEL', 'MB_YESNO', 'MB_RETRYCANCEL']);

const codeSection = source.slice(source.indexOf('[Code]'));
assert.ok(codeSection.length > 0, 'installer.iss must have a [Code] section');

// Only look at identifiers in the `mb*` and `MB_*` families: those are the ones
// whose wrong spelling compiles to nothing and fails late.
const used = (pattern) => [...new Set(codeSection.match(new RegExp(`\\b${pattern}\\b`, 'g')) ?? [])];

for (const constant of used('mb[A-Z][A-Za-z]*')) {
  assert.ok(messageBoxTypes.has(constant),
    `installer.iss [Code] uses ${constant}, which Inno Setup does not define; the real message-box types are ${[...messageBoxTypes].join(', ')}`);
}
for (const constant of used('MB_[A-Z]+')) {
  assert.ok(messageBoxButtons.has(constant),
    `installer.iss [Code] uses ${constant}, which Inno Setup does not define as a message-box button set`);
}

// The destructive path must be reachable only through its own flag, and it must
// ask twice before it deletes anything.
const removeEverything = codeSection.slice(
  codeSection.indexOf("function RemoveEverything"),
  codeSection.indexOf('function InitializeUninstall'));
assert.ok(removeEverything.length > 0, 'RemoveEverything must exist');
// Counting MsgBox calls is not enough: a confirmation can be short-circuited
// and still be counted. Each one must be a real MsgBox whose answer is tested
// against IDYES, and each must be able to abandon the removal.
const answers = removeEverything.match(/MsgBox\([\s\S]*?\)\s*<>\s*IDYES/g) ?? [];
assert.ok(answers.length >= 2,
  `complete removal must ask for two independent confirmations whose answers are honoured; found ${answers.length}`);
for (const answer of answers) {
  assert.match(answer, /mbError|mbConfirmation|mbCriticalError/,
    'every destructive confirmation must be a warning-strength dialog');
}
const refusals = (removeEverything.match(/Nothing was deleted/g) ?? []).length;
assert.ok(refusals >= 2, `each confirmation must have a path that abandons the removal; found ${refusals}`);
// A confirmation that can never block is not a confirmation.
assert.doesNotMatch(removeEverything, /if False then|if \$ false|;\s*\{.*skip/i,
  'a destructive confirmation must not be short-circuited');
assert.match(removeEverything, /-ConfirmRemoval/, 'complete removal must pass -ConfirmRemoval to the script');

// The ordinary uninstall path must not be able to reach the destructive script.
const initialize = codeSection.slice(codeSection.indexOf('function InitializeUninstall'));
const guardAt = initialize.indexOf('/REMOVEEVERYTHING');
assert.ok(guardAt >= 0, 'ordinary uninstall must branch on the flag');
// The default path and the destructive one are different functions, so the
// safe branch is proved by which function each one calls, not by position.
const afterGuard = initialize.slice(guardAt, initialize.indexOf('if Choice = IDNO'));
assert.equal(/RemoveProgramKeepData\(\)/.test(afterGuard), false,
  'the destructive branch must not be able to reach the ordinary removal');
const safeBranch = initialize.slice(initialize.indexOf('if Choice = IDNO'));
assert.match(safeBranch, /RemoveProgramKeepData\(\)/, 'the ordinary uninstall must remove the program and keep the data');

// The script that deletes everything must never be reachable without the flag.
assert.equal(/InitializeUninstall[\s\S]*remove-everything\.ps1/.test(codeSection), false,
  'ordinary uninstall must never call remove-everything.ps1');

console.log('PASS: installer [Code] uses only Inno-defined message-box constants, and removal stays behind its flag');
