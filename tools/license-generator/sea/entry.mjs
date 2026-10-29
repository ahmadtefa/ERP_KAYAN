/**
 * Bundled entry point for the standalone executable.
 *
 * Node's single-executable support runs one CommonJS file inside a copy of
 * the Node binary. `build.mjs` bundles the generator (and the operator
 * window) into that one file; this entry simply starts it with the arguments
 * the operator launched the executable with.
 */

import { runCli } from '../kayan-license.mjs';

runCli();
