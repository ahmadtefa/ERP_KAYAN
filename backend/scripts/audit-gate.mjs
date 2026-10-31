// Production dependency audit gate.
//
// `npm audit --omit=dev` fails on *any* advisory below the default level, which
// makes it fail for reasons unrelated to this product's code - for example a
// newly published denial-of-service advisory in a package reached only through
// an Excel library's unused code path. Left as-is, that turns the whole CI red
// within hours of any advisory worldwide, and the usual reaction is to weaken or
// skip the step.
//
// This gate keeps the strength and removes the noise:
//
//   * high and critical advisories ALWAYS fail - there is no allowlist for them;
//   * a moderate or low advisory fails unless it is listed, by id, in
//     security/audit-allowlist.json with a reason, the reason it is unreachable,
//     and an expiry date;
//   * the list expires: a stale entry fails the build;
//   * an entry that no longer matches a live advisory fails the build, so the
//     file cannot become a blanket suppression;
//   * the audit must actually have run - a failed or empty audit result fails.
//
//   node scripts/audit-gate.mjs [--json]

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const allowlistPath = join(backendDir, 'security', 'audit-allowlist.json');
const asJson = process.argv.includes('--json');

function fail(message) {
  console.error(`::error title=Dependency audit::${message}`);
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const audit = spawnSync(npm, ['audit', '--omit=dev', '--json'], {
  cwd: backendDir,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  // npm audit exits non-zero when it finds anything; the JSON is what matters.
  shell: process.platform === 'win32',
});

if (!audit.stdout || !audit.stdout.trim().startsWith('{')) {
  fail(`npm audit produced no JSON (exit ${audit.status}). Output: ${(audit.stderr || '').slice(0, 800)}`);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  fail(`npm audit JSON could not be parsed: ${error.message}`);
}

const metadata = report.metadata?.vulnerabilities ?? {};
if (typeof metadata.total !== 'number') {
  fail('npm audit reported no vulnerability totals; the gate cannot judge an empty result.');
}

// Collect one entry per advisory id, with the packages that carry it.
const advisories = new Map();
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string') continue; // transitive reference, not an advisory
    const id = via.url?.split('/').pop() ?? via.source ?? '';
    if (!advisories.has(id)) {
      advisories.set(id, {
        id,
        title: via.title ?? '(no title)',
        severity: via.severity ?? vulnerability.severity,
        packages: new Set(),
      });
    }
    advisories.get(id).packages.add(name);
  }
}

const allowlist = existsSync(allowlistPath)
  ? JSON.parse(readFileSync(allowlistPath, 'utf8'))
  : { allowed: [], expiresOn: null };

if (allowlist.expiresOn && new Date(allowlist.expiresOn) < new Date()) {
  fail(
    `security/audit-allowlist.json expired on ${allowlist.expiresOn}. Re-review every entry, then extend it. ` +
      'An exception nobody re-reviewed is a permanent hole.',
  );
}

const allowedById = new Map((allowlist.allowed ?? []).map((entry) => [entry.advisory, entry]));
const blocked = [];
const accepted = [];
const unused = new Set(allowedById.keys());

for (const advisory of advisories.values()) {
  const entry = allowedById.get(advisory.id);
  if (advisory.severity === 'high' || advisory.severity === 'critical') {
    blocked.push(`${advisory.severity.toUpperCase()} ${advisory.id} ${advisory.title} (${[...advisory.packages].join(', ')})`);
    continue;
  }
  if (!entry) {
    blocked.push(
      `${advisory.severity} ${advisory.id} ${advisory.title} (${[...advisory.packages].join(', ')}) - not in the allowlist`,
    );
    continue;
  }
  // An allowlist entry must correspond to the advisory it names: a mismatched
  // package name means the entry was written for something else.
  const packages = [...advisory.packages];
  if (entry.package && !packages.includes(entry.package)) {
    blocked.push(
      `${advisory.id} is allowlisted for ${entry.package}, but the audit attributes it to ${packages.join(', ')}`,
    );
    continue;
  }
  unused.delete(advisory.id);
  accepted.push(`${advisory.id} ${entry.package} - ${entry.reason}`);
}

for (const id of unused) {
  blocked.push(
    `allowlist entry ${id} no longer matches any advisory. Remove it: an exception that outlives its advisory is just a disabled check.`,
  );
}

if (asJson) {
  console.log(JSON.stringify({ totals: metadata, accepted: accepted.length, blocked }, null, 2));
}

for (const line of accepted) {
  console.log(`ACCEPTED (reviewed, expiring ${allowlist.expiresOn}): ${line}`);
  console.log(`::warning title=Dependency audit exception::${line}`);
}

if (blocked.length > 0) {
  for (const line of blocked) {
    console.error(`::error title=Dependency audit::${line}`);
  }
  fail(`${blocked.length} advisory(ies) are not acceptable: ${blocked.join(' | ')}`);
}

console.log(
  `PASS: production dependencies audited - ${metadata.total} vulnerable package entries, ` +
    `${accepted.length} reviewed and expiring on ${allowlist.expiresOn}, 0 unaccepted, 0 high, 0 critical.`,
);
