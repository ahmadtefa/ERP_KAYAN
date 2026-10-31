import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReleaseEnvironment } from './check-release-environment.mjs';

const good = () => ({
  name: 'windows-production',
  protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User' }] }],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
});

test('requires reviewers, no self-review and protected deployment branches', () => {
  assert.equal(validateReleaseEnvironment(good()), true);
  const noRules = good(); noRules.protection_rules = [];
  const noReviewers = good(); noReviewers.protection_rules[0].reviewers = [];
  const selfReview = good(); selfReview.protection_rules[0].prevent_self_review = false;
  const unprotected = good(); unprotected.deployment_branch_policy.protected_branches = false;
  for (const bad of [null, noRules, noReviewers, selfReview, unprotected]) {
    assert.throws(() => validateReleaseEnvironment(bad));
  }
});
