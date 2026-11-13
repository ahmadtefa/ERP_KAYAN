// Publication entrypoint: no branch builds, alternate artifact path or release
// overwrite. The independent verifier must attest the exact file and run.
import { spawnSync } from 'node:child_process';
import { checkTag, DECISION } from './check-release-tag.mjs';

const artifact = 'release-candidate/KAYAN-ERP-Setup.exe';
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; publication refused.`);
  return result.stdout;
}

async function main() {
  if (process.argv.length !== 2 || process.env.GITHUB_REPOSITORY !== 'ahmadtefa/ERP_KAYAN' ||
      process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'push' ||
      !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') || !process.env.GH_TOKEN) {
    throw new Error('Publication is allowed only for a main push in the approved repository.');
  }
  const version = process.env.APP_VERSION || '';
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid application version.');
  // Recheck immediately before invoking gh. These two programs fail closed.
  run(process.execPath, ['scripts/check-release-environment.mjs']);
  run(process.execPath, ['scripts/inspect-final-inno.mjs', '--artifact', artifact]);
  run(process.execPath, ['scripts/verify-release-evidence.mjs', '--artifact', artifact]);
  const tag = `windows-v${version}`;
  const verdict = await checkTag(tag, { repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
  if (verdict.decision !== DECISION.PUBLISH) throw new Error('The release already exists or its state could not be verified.');
  // Require a pre-existing lightweight tag pointing directly at this commit.
  // Protect release tags independently; the release job will not create one.
  const ref = JSON.parse(run('gh', ['api', `repos/ahmadtefa/ERP_KAYAN/git/ref/tags/${tag}`]));
  if (ref?.object?.type !== 'commit' || ref.object.sha !== process.env.GITHUB_SHA) {
    throw new Error('The pre-existing release tag does not point directly to this commit.');
  }
  run('gh', ['release', 'create', tag, artifact, '--verify-tag', '--title', `KAYAN ERP Windows ${version}`, '--generate-notes']);
  console.log('Verified installer published without replacing an existing release.');
}

main().catch(error => { console.error(`Release refused: ${error.message}`); process.exitCode = 1; });
