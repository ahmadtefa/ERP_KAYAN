// The no-skip verdict for one spec file. A pending case is accepted only when
// its exact identity is listed in the bridge manifest for that file; the
// manifest is never a waiver for anything else.
export function classify({ exitStatus, report, registered, cases, allowedIdentities }) {
  const executed = cases.map((c) => c.fullName).sort();
  const pendingIds = cases.filter((c) => c.status === 'pending').map((c) => c.fullName).sort();
  const allowed = new Set(allowedIdentities ?? []);
  const unmanifested = pendingIds.filter((n) => !allowed.has(n));
  const bad = cases.filter((c) => !['passed', 'pending'].includes(c.status));
  let reason;
  if (exitStatus !== 0 || report.numFailedTests || report.numFailedTestSuites || report.numRuntimeErrorTestSuites || bad.length) reason = 'failed cases or suites';
  else if (!registered.length || JSON.stringify(registered) !== JSON.stringify(executed)) reason = `registered ${registered.length} vs executed ${executed.length} case identities differ`;
  else if (!report.numPassedTests && !pendingIds.length) reason = 'no case ran';
  else if (report.numTodoTests) reason = 'todo cases';
  else if (unmanifested.length) reason = `${unmanifested.length} pending/skipped case identities are not in the bridge manifest`;
  else return { verdict: pendingIds.length ? 'PASS_BRIDGE_MANIFESTED_PENDING' : 'PASS', reason: '', pendingIds, executed };
  return { verdict: 'FAIL', reason, pendingIds, executed };
}
