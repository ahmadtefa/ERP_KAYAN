'use strict';
// Diagnostic only: screenshot fixtures use synthetic data. The regular
// golden-comparison job remains independent and must still fail if baselines
// are missing or differ. Never run on customer files.
const fs = require('node:fs');
const path = require('node:path');
const files = ['dashboard_ar.png', 'customers_ar.png', 'sales_invoices_ar.png'];
const name = process.argv[2];
if (!files.includes(name)) throw Error('Unrecognised synthetic screenshot');
const image = fs.readFileSync(path.join('test/screenshots/goldens', name));
if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Not PNG');
const encoded = image.toString('base64');
const chunkSize = 45000;
const total = Math.ceil(encoded.length / chunkSize);
if (total > 9) throw Error('Screenshot exceeds the per-step annotation limit');
for (let i = 0; i < total; i++) {
  const data = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
  console.log(`::notice title=Synthetic screenshot preview::KAYANPNG|${name}|${i + 1}|${total}|${data}`);
}
