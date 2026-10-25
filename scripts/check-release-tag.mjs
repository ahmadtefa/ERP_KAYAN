#!/usr/bin/env node
/**
 * Refuses to publish a Windows build over a release that already exists.
 *
 * Why this exists: the installer workflow publishes `windows-v<version>` from
 * `main` with `allowUpdates` and `replacesArtifacts`, which is what you want
 * while a release is being assembled and exactly what you do not want once it
 * has been handed to customers. A push to `main` without a version bump would
 * silently replace the published Setup.exe of that version, and anyone who
 * downloaded it earlier would have no way to tell the two files apart.
 *
 * The rule this enforces:
 *   * no release for the tag            -> publish;
 *   * a release with no assets yet      -> publish (an earlier run stopped
 *                                          before uploading; retrying is safe);
 *   * a release that already has assets -> refuse, and say what to do;
 *   * the API cannot be asked           -> refuse. "We could not check" must
 *                                          never turn into "we overwrote it".
 *
 * Usage:
 *   GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/check-release-tag.mjs windows-v0.2.0
 */
import { fileURLToPath } from 'node:url';

export const DECISION = {
  PUBLISH: 'publish',
  PUBLISH_WITH_WARNING: 'publish-with-warning',
  REFUSE_PUBLISHED: 'refuse-published',
  REFUSE_UNVERIFIED: 'refuse-unverified',
};

/// What to do about the tag, given what GitHub said.
///
/// `response` is `{ status, body }`: the HTTP status and the parsed JSON, or
/// `null` for a thrown request. Keeping this pure is what lets the decision be
/// tested without a network.
export function decide(tag, response) {
  if (!response) {
    return {
      decision: DECISION.REFUSE_UNVERIFIED,
      reason: `the release for ${tag} could not be checked`,
    };
  }
  if (response.status === 404) {
    return { decision: DECISION.PUBLISH, reason: `${tag} does not exist yet` };
  }
  if (response.status !== 200) {
    return {
      decision: DECISION.REFUSE_UNVERIFIED,
      reason: `GitHub answered ${response.status} for ${tag}`,
    };
  }
  const assets = Array.isArray(response.body?.assets) ? response.body.assets : [];
  if (assets.length === 0) {
    return {
      decision: DECISION.PUBLISH_WITH_WARNING,
      reason: `${tag} exists but has no files yet; an earlier run stopped before publishing`,
    };
  }
  const names = assets.map((asset) => asset?.name ?? 'unnamed').join(', ');
  return {
    decision: DECISION.REFUSE_PUBLISHED,
    reason:
      `${tag} is already published with ${assets.length} file(s): ${names}. ` +
      'Publishing this build would replace them. Bump the version in pubspec.yaml ' +
      'for a new release; this workflow will not overwrite a published download.',
  };
}

export async function checkTag(tag, { repository, token, fetchImpl = fetch }) {
  if (!repository) return decide(tag, null);
  let response;
  try {
    const answer = await fetchImpl(
      `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'kayan-release-guard',
        },
      },
    );
    const text = await answer.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    response = { status: answer.status, body };
  } catch {
    response = null;
  }
  return decide(tag, response);
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const tag = process.argv[2];
  if (!tag) {
    console.error('usage: node scripts/check-release-tag.mjs <tag>');
    process.exit(2);
  }
  const verdict = await checkTag(tag, {
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  });
  const message = `release guard: ${verdict.decision} - ${verdict.reason}`;
  if (verdict.decision === DECISION.PUBLISH) {
    console.log(message);
    process.exit(0);
  }
  if (verdict.decision === DECISION.PUBLISH_WITH_WARNING) {
    console.log(`::warning title=${tag}::${verdict.reason}`);
    process.exit(0);
  }
  console.error(`::error title=Release ${tag} is protected::${verdict.reason}`);
  process.exit(verdict.decision === DECISION.REFUSE_PUBLISHED ? 3 : 4);
}
