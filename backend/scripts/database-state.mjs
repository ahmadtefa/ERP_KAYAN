/**
 * How "what state is this database in" is decided, in one small place.
 *
 * The states the desktop shell understands (printed as
 * `KAYAN-DB-STATE=<state>` by prepare-database.mjs):
 *
 *   empty      - the schema is there and there is no company and no
 *                user yet: a database that has just been created.
 *                First-run setup has not happened.
 *   incomplete - exactly one of company / users exists without the
 *                other: first-run setup began (or data was partly
 *                removed) but never finished. It is NOT empty and
 *                must not be reported as such; completing setup is
 *                still safe because the seeding program upserts.
 *   ready      - a company and at least one user exist: an ordinary
 *                installation. Never ask for first-run setup again.
 *   unknown    - the question could not be answered (the database did
 *                not answer, or the schema is not there). A failure
 *                to ask is NEVER reported as "empty": pretending a
 *                database is new because a query failed would invite
 *                a second first-run setup over somebody's data.
 *
 * This mirrors the API health payload's `needsSetup`
 * (companies === 0 || users === 0), so the shell (before the server
 * starts) and the server (once running) give the same answer about
 * the same database.
 */
export function classifyDatabaseState({ companies, users }) {
  if (!Number.isInteger(companies) || !Number.isInteger(users)) {
    return 'unknown';
  }
  if (companies === 0 && users === 0) return 'empty';
  if (companies === 0 || users === 0) return 'incomplete';
  return 'ready';
}

/// The states in which the machine still needs its first administrator
/// (or the completion of an interrupted first-run setup).
export function needsFirstAdministrator(state) {
  return state === 'empty' || state === 'incomplete';
}
