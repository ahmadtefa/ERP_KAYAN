'use strict';
// Emits exact PNG bytes in bounded CI log chunks so reviewed golden images can
// be transferred without lossy re-encoding. Diagnostic only; never commits.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const name = process.argv[2];
const allowed = ['dashboard_ar.png', 'customers_ar.png', 'sales_invoices_ar.png'];
if (!allowed.includes(name)) throw Error('Invalid screenshot name');
const file = fs.readFileSync(path.join('test/screenshots/goldens', name));
if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw Error('Screenshot is not a PNG');
}
const encoded = file.toString('base64');
const chunkSize = 3000;
const total = Math.ceil(encoded.length / chunkSize);
console.log('::notice title=Exact screenshot PNG metadata::KAYANPNG_META|' + name + '|' + file.length + '|' + crypto.createHash('sha256').update(file).digest('hex') + '|' + total);
for (let i = 0; i < total; i++) {
  console.log('::notice title=Exact screenshot PNG chunk::KAYANPNG|' + name + '|' + (i + 1) + '|' + total + '|' + encoded.slice(i * chunkSize, (i + 1) * chunkSize));
}
