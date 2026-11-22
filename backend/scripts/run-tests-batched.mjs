#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const root = resolve(process.cwd(), 'src');
const batchSize = Number(process.argv[2] ?? '12');
if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error('Usage: node scripts/run-tests-batched.mjs [positive batch size]');
  process.exit(2);
}

function collect(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...collect(path));
    else if (entry.isFile() && entry.name.endsWith('.spec.ts')) result.push(path);
  }
  return result;
}

const files = collect(root).sort();
if (files.length === 0) {
  console.error(`No Jest spec files found under ${root}`);
  process.exit(2);
}

const jest = resolve(process.cwd(), 'node_modules/jest/bin/jest.js');
const batches = Math.ceil(files.length / batchSize);
console.log(`Running all ${files.length} Jest spec files in ${batches} sequential batches of at most ${batchSize}.`);

for (let index = 0; index < batches; index += 1) {
  const batch = files.slice(index * batchSize, (index + 1) * batchSize);
  console.log(`\n=== Jest batch ${index + 1}/${batches}: ${batch.length} spec files ===`);
  for (const file of batch) console.log(`  ${relative(process.cwd(), file).split(sep).join('/')}`);

  const result = spawnSync(
    process.execPath,
    [jest, '--runInBand', '--runTestsByPath', ...batch],
    { stdio: 'inherit', env: process.env },
  );
  if (result.error) {
    console.error(`Could not start Jest batch ${index + 1}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`Jest batch ${index + 1} terminated by ${result.signal}.`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Jest batch ${index + 1}/${batches} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${files.length} Jest spec files passed across ${batches} sequential batches.`);
