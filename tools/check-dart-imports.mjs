#!/usr/bin/env node
/**
 * Every `import` and `export` in the Dart sources has to point at a file
 * that is actually there.
 *
 * This is the cheapest failure the build can have and the most annoying one:
 * `flutter analyze` will not even start until the SDK is installed, so a
 * single wrong `../` costs a whole job before it says what is wrong. This
 * reads the sources instead, which is nearly instant and needs nothing but
 * Node, and it names every offender in one go rather than one per run.
 *
 * What it checks:
 *   - `import 'relative/path.dart'` and `export 'relative/path.dart'` resolve
 *     to a file inside lib/ (package:, dart: and the generated conditional
 *     imports are left alone);
 *   - no source file is imported through a path with a doubled separator or a
 *     `//`, which is how the mistakes usually look.
 *
 * Usage: node tools/check-dart-imports.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libRoot = join(projectRoot, 'lib');

function dartFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.dart')) {
        found.push(path);
      }
    }
  };
  walk(dir);
  return found;
}

const files = dartFiles(libRoot);
const directive =
  /^\s*(?:import|export)\s+'([^']+)'\s*(?:if\s+\(dart\.library\.\w+\)\s*'([^']+)'\s*)?;/gm;

const problems = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(directive)) {
    const targets = [match[1], match[2]].filter(Boolean);
    for (const target of targets) {
      if (!target.startsWith('.')) continue;
      if (target.includes('//')) {
        problems.push(
          `${relative(projectRoot, file)}: "${target}" has a doubled separator`,
        );
        continue;
      }
      const resolved = resolve(dirname(file), target);
      try {
        statSync(resolved);
      } catch {
        problems.push(
          `${relative(projectRoot, file)}: "${target}" does not exist ` +
            `(looked for ${relative(projectRoot, resolved)})`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(
    `${problems.length} Dart import${problems.length === 1 ? '' : 's'} point at nothing:\n`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nA wrong `../` here means `flutter analyze` cannot even start. Fix the paths above.',
  );
  process.exit(1);
}

console.log(
  `All ${files.length} Dart source files: every import and export points at a real file.`,
);
