'use strict';
// Diagnostic only. These downscaled, lossy previews contain synthetic test
// data. They are NOT golden baselines, and do not change the independent
// full-resolution screenshot-comparison job.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../backend/node_modules/sharp');
const files = ['dashboard_ar.png', 'customers_ar.png', 'sales_invoices_ar.png'];
const name = process.argv[2];
if (!files.includes(name)) throw Error('Unrecognised synthetic screenshot');
(async () => {
  const image = fs.readFileSync(path.join('test/screenshots/goldens', name));
  if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Not PNG');
  const preview = await sharp(image).resize({ width: 640 }).jpeg({ quality: 35 }).toBuffer();
  const encoded = preview.toString('base64');
  // Check annotations cap message content at 4096 characters.
  const chunkSize = 3000;
  const total = Math.ceil(encoded.length / chunkSize);
  if (total > 9) throw Error('Screenshot preview exceeds the per-step annotation limit');
  for (let i = 0; i < total; i++) {
    const data = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
    console.log(`::notice title=Synthetic low-resolution preview::KAYANJPEG|${name}|${i + 1}|${total}|${data}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
