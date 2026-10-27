# مولّد مفاتيح ترخيص كيان / KAYAN licence generator

أداة المورّد. **لا تُشحن مع البرنامج ولا تُثبَّت عند العميل.**
The supplier's key generator. **Never shipped to a customer, never installed
with the program.** It holds the Ed25519 private key; the product holds only
the public half and can verify, never sign.

## نافذة المشغّل / The operator window

```
KAYAN-Key-Generator.exe            (double-click; opens the local window)
node kayan-license.mjs             (same, from a source checkout)
```

`KAYAN-Key-Generator.exe` is a native Windows Forms window hosting the local UI
inside WebView2; it does not open the default browser or show a CMD window. The
bundled `KAYAN-Key-Generator-Server.exe` runs the local API hidden beside it.
Keep both executables together. Windows needs the Microsoft Edge WebView2 Runtime
(which is present on most current Windows 10/11 installations). The native-window
smoke test runs in the Windows CI workflow. The CLI and `gui --no-browser` remain
available for development and diagnostics, and every licensing command below
still works unchanged.

## سطر الأوامر / The command line

```
node kayan-license.mjs init
node kayan-license.mjs licence create --ref "customer note" --seats 5 --term 1y
node kayan-license.mjs issue activation --licence lic_xxx --request KYNREQ1.…
node kayan-license.mjs issue renewal    --licence lic_xxx --term 1y
node kayan-license.mjs issue seats      --licence lic_xxx --increase 2
node kayan-license.mjs issue transfer   --licence lic_xxx --machine KM-...
node kayan-license.mjs issue … --dry-run          (preview, nothing signed)
node kayan-license.mjs list
node kayan-license.mjs verify "KYN1.…"
node kayan-license.mjs backup --out D:\kayan-licence-backup
```

- Needs Node 20 or newer and nothing else: no packages, no network. The
  packaged `.exe` bundles the runtime, so the operator needs nothing at all.
- The key directory (default `~/.kayan-license-generator`) is git-ignored and
  is the only place a private key ever lives. The executable contains none.
- Every action is appended to `audit.log` beside the register.

## المصادر والبناء / Source and packaging

| | |
| --- | --- |
| `kayan-license.mjs` | every licensing rule, and the command line |
| `license-gui.mjs` | the local window (no licensing logic of its own) |
| `sea/` | build-time packaging: `esbuild` + Node SEA + `postject` |

```
cd sea && npm ci
node build.mjs --target win32-x64 --out ../dist
node smoke.mjs --exe ../dist/KAYAN-Key-Generator.exe
```

Read [`../../docs/licensing/GENERATOR.md`](../../docs/licensing/GENERATOR.md)
for the operator procedures, and
[`../../docs/licensing/KEY-PROTECTION.md`](../../docs/licensing/KEY-PROTECTION.md)
before issuing the first key.

The public key this tool prints goes into the product as `LICENSE_PUBLIC_KEY`
(or as `public-key.pem` in the licence state folder). The same value is what
the installer installs from `distribution/windows/public-key.pem` when a build
is prepared for a customer.
