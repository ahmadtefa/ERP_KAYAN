/**
 * How "what state is this database in" is decided, in one small place.
 *
 * The states the desktop shell understands (printed as
 * `KAYAN-DB-STATE=<state>` by prepare-database.mjs):
 *
 *   empty      - the schema is there and there is no company and no
 *                user yet: a database that has just been created.
 *                First-run setup has not happened.
 *   incomplete - no company exists, but users are present.
 *   recovery_required - a company or its history exists but no active user
 *                belongs to an active company. Preserve data and recover access.
 *   ready      - a company and at least one user exist: an ordinary
 *                installation. Never ask for first-run setup again.
 *   unknown    - the question could not be answered (the database did
 *                not answer, or the schema is not there). A failure
 *                to ask is NEVER reported as "empty": pretending a
 *                database is new because a query failed would invite
 *                a second first-run setup over somebody's data.
 *
 * This mirrors the API health payload's `needsSetup` and
 * `recoveryRequired`, without treating existing data as a new installation.
 */
export function classifyDatabaseState({ companies, users, activeCompanyUsers = users }) {
  if (!Number.isInteger(companies) || !Number.isInteger(users) || !Number.isInteger(activeCompanyUsers) || companies < 0 || users < 0 || activeCompanyUsers < 0) {
    return 'unknown';
  }
  if (companies === 0 && users === 0) return 'empty';
  if (companies > 0 && activeCompanyUsers === 0) return 'recovery_required';
  if (companies === 0) return 'incomplete';
  return 'ready';
}

/// The states in which the machine still needs its first administrator
/// (or the completion of an interrupted first-run setup).
export function needsFirstAdministrator(state) {
  return state === 'empty' || state === 'incomplete';
}
