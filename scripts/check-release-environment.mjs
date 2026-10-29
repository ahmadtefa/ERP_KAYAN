// Verify GitHub environment protections through the API; an environment name
// in a workflow alone is not a protection rule. This performs GET only.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateReleaseEnvironment(data) {
  if (!data || data.name !== 'windows-production' || !Array.isArray(data.protection_rules)) {
    throw new Error('The Windows production environment is missing or invalid.');
  }
  const review = data.protection_rules.find(rule => rule.type === 'required_reviewers');
  if (!review || review.prevent_self_review !== true || !Array.isArray(review.reviewers) || review.reviewers.length < 1) {
    throw new Error('The Windows production environment needs required reviewers and prevent-self-review.');
  }
  // Requiring protected branches ensures GitHub checks branch protection rather
  // than a user-provided workflow input. The repository must also separately
  // protect main and review modifications to the workflow and authority key.
  if (data.deployment_branch_policy?.protected_branches !== true) {
    throw new Error('The Windows production environment must restrict deployments to protected branches.');
  }
  return true;
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'ahmadtefa/ERP_KAYAN' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Production release is restricted to this repository on main.');
  }
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GitHub token is unavailable for environment metadata.');
  const response = await fetch('https://api.github.com/repos/ahmadtefa/ERP_KAYAN/environments/windows-production', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Unable to verify environment protections (HTTP ${response.status}).`);
  validateReleaseEnvironment(await response.json());
  console.log('Required Windows environment protection metadata verified.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Release gate refused: ${error.message}`); process.exitCode = 1; });
}
