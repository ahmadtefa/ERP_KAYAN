'use strict';
// Diagnostic only. These downscaled, lossy previews contain synthetic test
// data. They are NOT golden baselines, and do not change the independent
// full-resolution screenshot-comparison job.
const fs = require('node:fs');
const path = require('node:path');
const files = ['dashboard_ar.png', 'customers_ar.png', 'sales_invoices_ar.png'];
const name = process.argv[2];
if (!files.includes(name)) throw Error('Unrecognised synthetic screenshot');
(async () => {
  const sharp = require('../backend/node_modules/sharp');
  const image = fs.readFileSync(path.join('test/screenshots/goldens', name));
  if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Not PNG');
  // Adapt the preview only, never the full-resolution golden. Check
  // annotations cap messages at 4096 characters and limit a step to 10.
  const chunkSize = 3000;
  let encoded = '';
  for (const [width, quality] of [[640, 35], [480, 28], [360, 22]]) {
    encoded = (await sharp(image).resize({ width }).jpeg({ quality }).toBuffer()).toString('base64');
    if (Math.ceil(encoded.length / chunkSize) <= 9) break;
  }
  const total = Math.ceil(encoded.length / chunkSize);
  if (total > 9) throw Error('Screenshot preview exceeds the per-step annotation limit');
  for (let i = 0; i < total; i++) {
    const data = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
    console.log(`::notice title=Synthetic low-resolution preview::KAYANJPEG|${name}|${i + 1}|${total}|${data}`);
  }
})().catch(error => {
  console.error(`::error title=Preview encoding failed::${String(error.message).replace(/[\r\n%]/g, ' ')}`);
  process.exitCode = 1;
});
