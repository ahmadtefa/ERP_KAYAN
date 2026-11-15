'use strict';
// Synthetic diagnostic transport only. The regular job still compares
// committed goldens. The exact RGBA hash is checked before emitting lossless
// WebP chunks, so a preview can be independently reconstructed and reviewed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const names = ['dashboard_ar.png', 'customers_ar.png', 'sales_invoices_ar.png'];
const [name, groupArg] = process.argv.slice(2);
const group = Number(groupArg);
if (!names.includes(name) || !Number.isInteger(group) || group < 0 || group > 4) {
  throw Error('Invalid screenshot or chunk group');
}
(async () => {
  const sharp = require('../backend/node_modules/sharp');
  const image = fs.readFileSync(path.join('test/screenshots/goldens', name));
  if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Not PNG');
  const webp = await sharp(image).webp({lossless:true, effort:6}).toBuffer();
  const source = await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const decoded = await sharp(webp).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if (source.info.width !== decoded.info.width || source.info.height !== decoded.info.height || !source.data.equals(decoded.data)) {
    throw Error('Transport changed screenshot pixels');
  }
  const hash = data => crypto.createHash('sha256').update(data).digest('hex');
  const encoded = webp.toString('base64');
  const chunkSize = 3800;
  const total = Math.ceil(encoded.length / chunkSize);
  if (total > 45) throw Error('Screenshot exceeds the check-run annotation limit');
  if (group === 0) {
    console.log(`::notice title=Lossless synthetic screenshot metadata::KAYANMETA|${name}|${source.info.width}|${source.info.height}|${hash(source.data)}|${hash(webp)}|${hash(image)}|${total}`);
  }
  for (let i = group * 9; i < Math.min((group + 1) * 9, total); i++) {
    const data = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
    console.log(`::notice title=Lossless synthetic screenshot chunk::KAYANWEBP|${name}|${i + 1}|${total}|${data}`);
  }
})().catch(error => {
  console.error(`::error title=Lossless screenshot encoding failed::${String(error.message).replace(/[\r\n%]/g, ' ')}`);
  process.exitCode = 1;
});
