// Fail-closed guard for the destructive, disposable Windows installer smoke VM.
// The GitHub Environment must have required reviewers (with self-review disabled)
// and an exact deployment-branch allow-list for this test branch.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPOSITORY = 'ahmadtefa/ERP_KAYAN';
const ENVIRONMENT = 'windows-installer-test';
const ARENA_BRANCH = 'arena/56e71924-erp-kayan';
const WORK_BRANCH = 'work/bilingual-names-opening-balances';

export function validateInstallerTestEnvironment(environment, policies, branch = ARENA_BRANCH) {
  if (!environment || environment.name !== ENVIRONMENT || !Array.isArray(environment.protection_rules)) {
    throw new Error('The windows-installer-test environment is missing or invalid.');
  }
  const reviewers = environment.protection_rules.find(rule => rule.type === 'required_reviewers');
  if (!reviewers || reviewers.prevent_self_review !== true ||
      !Array.isArray(reviewers.reviewers) || reviewers.reviewers.length < 1) {
    throw new Error('Installer smoke requires at least one required reviewer and prevent-self-review.');
  }
  if (environment.deployment_branch_policy?.custom_branch_policies !== true) {
    throw new Error('Installer smoke environment must use a custom deployment branch allow-list.');
  }
  if (!Array.isArray(policies) || !policies.some(policy => policy.name === branch && policy.type === 'branch')) {
    throw new Error('The exact installer-test branch is not allow-listed in the protected environment.');
  }
  return true;
}

async function main() {
  const ref = process.env.GITHUB_REF;
  const branch = [ARENA_BRANCH, WORK_BRANCH].find(candidate => ref === `refs/heads/${candidate}`);
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || !branch) {
    throw new Error('Installer smoke is restricted to the approved ERP_KAYAN test branch.');
  }
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GitHub token is unavailable for environment metadata.');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = `https://api.github.com/repos/${REPOSITORY}/environments/${ENVIRONMENT}`;
  const environmentResponse = await fetch(base, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!environmentResponse.ok) throw new Error(`Cannot verify installer-test environment protections (HTTP ${environmentResponse.status}).`);
  const environment = await environmentResponse.json();
  const policiesResponse = await fetch(`${base}/deployment-branch-policies?per_page=100`, {
    headers, redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!policiesResponse.ok) throw new Error(`Cannot verify installer-test branch allow-list (HTTP ${policiesResponse.status}).`);
  const policies = await policiesResponse.json();
  validateInstallerTestEnvironment(environment, policies.branch_policies, branch);
  console.log('Approved Windows installer-test environment and exact branch allow-list verified.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Installer smoke environment refused: ${error.message}`); process.exitCode = 1; });
}
