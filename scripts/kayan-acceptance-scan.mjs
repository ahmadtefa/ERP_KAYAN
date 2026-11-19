#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = new URL('../lib/features/', import.meta.url);
const output = process.argv[2] ?? 'build/acceptance/screen-audit.json';
function dartFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? dartFiles(join(dir, entry.name)) : entry.name.endsWith('.dart') ? [join(dir, entry.name)] : []);
}
const findings = [];
for (const file of dartFiles(root.pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const source = readFileSync(file, 'utf8');
  const screen = file.replaceAll('\\', '/').split('/lib/features/')[1];
  if (/TextFormField|DropdownButtonFormField|Form\(/.test(source) && /\.post\(|\.put\(|\.patch\(/.test(source)
      && !/showFormSheet|fieldErrors|errorText|validator:/.test(source)) {
    findings.push({ screen, kind: 'custom form review', status: 'NOT TESTED',
      reason: 'Submission and custom input appear together; behavior needs a widget test.' });
  }
  if (/\bScaffold\(/.test(source) && /backgroundColor:\s*(?:Colors\.white|Color\(0xFFFFFFFF\))/.test(source)) {
    findings.push({ screen, kind: 'theme review', status: 'NOT TESTED',
      reason: 'A fixed white scaffold appears; verify its rendered background in both themes.' });
  }
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ findings }, null, 2) + '\n');
console.log(`${findings.length} screens need behavioral review; structural matches are not failures.`);
