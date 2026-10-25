# مولّد مفاتيح ترخيص كيان / KAYAN licence generator

أداة المورّد. **لا تُشحن مع البرنامج ولا تُثبَّت عند العميل.**

The supplier's key generator. **Never shipped to a customer, never installed
with the program.** It holds the Ed25519 private key; the product holds only
the public half and can verify, never sign.

```
node kayan-license.mjs init
node kayan-license.mjs licence create --ref "customer note" --seats 5 --term 1y
node kayan-license.mjs issue activation --licence lic_xxx --machine KM-...
node kayan-license.mjs issue renewal    --licence lic_xxx --term 1y
node kayan-license.mjs issue seats      --licence lic_xxx --increase 2
node kayan-license.mjs issue transfer   --licence lic_xxx --machine KM-...
node kayan-license.mjs list
node kayan-license.mjs backup --out D:\kayan-licence-backup
```

- Needs Node 18 or newer and nothing else: no packages, no network.
- The key directory (default `~/.kayan-license-generator`) is git-ignored.
- Read [`../../docs/licensing/OPERATOR-GUIDE.md`](../../docs/licensing/OPERATOR-GUIDE.md)
  and [`../../docs/licensing/KEY-PROTECTION.md`](../../docs/licensing/KEY-PROTECTION.md)
  before issuing the first key.

The public key this tool prints goes into the product as `LICENSE_PUBLIC_KEY`
(or as `public-key.pem` in the licence state folder). The same value is what
the installer installs from `distribution/windows/public-key.pem` when a build
is prepared for a customer.
