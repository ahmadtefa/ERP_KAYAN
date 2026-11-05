# Licence and installer test isolation — blocked

The current GitHub-hosted runners are **not established as approved licence-test VMs**. A repository runner inventory request returned HTTP 403; this does not prove whether an approved machine exists. An administrator must establish its existence and approval independently. Do not use or upload customer data, production private keys, tokens or state files as test inputs.

## Tests retained, not passed

* `backend/src/modules/licensing/license-store.spec.ts` requires HMAC state and is deliberately blocked before execution in the independent `licence-store-isolation` job. It has not passed on an approved VM. Ordinary non-HMAC code checks continue independently; the overall workflow is expected to fail on this blocker.
* The signing/compatibility tests and Windows installer build remain in `.github/workflows/windows-installer.yml`. The first build step **unconditionally blocks**, even on manual dispatch. The workflow therefore cannot currently produce an installer, including on an approved machine. This is an explicit temporary limitation, not a successful test, approved release or proof that setup works. No flag bypasses the block.
* Runtime-only installed Windows smoke currently expects Full Backup and restore endpoints to succeed although the product deliberately blocks them. This contradiction is untested on installed Windows; do not remove the guard or report the smoke as full recovery evidence.

## Requirements before controlled execution

1. Obtain independent approval of a disposable, isolated test VM, its owner, network and storage controls, runner trust, clean snapshot/revert process, and test data policy. A GitHub-hosted runner or a name/label alone is not proof of approval.
2. Design and review a path that runs only trusted commits in that approved environment, without exposing secrets or permitting untrusted PR code to select it. Configure the approved path before changing the hard blocker; do not bypass it by an input or environment variable.
3. Run the unchanged HMAC test with synthetic short-lived material only in that environment; record exact source SHA, test command, result, environment approval and cleanup. Do not store or upload key material. Independently run the retained signing/compatibility tests under the approved signing policy; synthetic signatures are not production-licence evidence.
4. Preserve the existing product build, payload inspection, installed-product and publisher checks when separating sensitive tests from ordinary code CI. Fix the Full Backup smoke contradiction without claiming that a guard check proves recovery. Validate no private material enters the package, logs, artifacts or repository.
5. Release remains blocked unless the publisher verifies independently authenticated evidence for the exact artifact. A green PR notice, Windows application build, synthetic test or installer compilation alone does not approve release. Fresh offline Windows 10/11, upgrade/repair, licensed business operation and safe full backup/restore remain required.
