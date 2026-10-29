# Windows product packaging probe

## Flow and sample data

`build-installer.ps1` builds the backend and Prisma client, stages backend runtime files and production dependencies, builds Flutter Windows and web, and stages the Node and PostgreSQL runtimes and installer scripts. `installer.iss` includes the stage recursively in an Inno executable. This document describes source behavior, not proof of the contents or execution of a completed EXE.

Before this packaging-only change, the builder explicitly copied `demo-data/kayan-company-backup-demo.json` from the checkout into `backend/demo-data` in the stage and required it. It is a downloadable sample company backup, not database configuration, a normal customer backup, or a first-run seed. `BackupService.demoBackup()` uses it for the optional demo-download endpoint. First-run company creation and normal backup/restore have separate paths. The builder no longer explicitly copies the sample; the existing endpoint returns its existing not-found response in an installation without it. The desktop UI still offers that download: this is a user-visible limitation, not a claim that the sample feature works. No customer or source data was deleted. The runtime database preparer and its dependency are staged explicitly; scenario runners and the demo generator are not. Compiled test files and the demo seeder are filtered from the staged backend trees. Installed dependencies and the completed EXE have not yet been comprehensively inspected.

## Public verification key

The build expects public Ed25519 verification material, never the signing private key. The public PEM added beside the installer script comes from the repository's `3f1e8a72c3fdc21f382d54fec06be9e8583615b9` tree; its blob `1f75659aab3973ad82aef544917fb35e98e242b1`, PEM SHA-256 `fb79dce066293a18d0e58b7e94242d2ed73d3ea376f9a131c5fde2f39d467897`, and SPKI fingerprint `F932-38B0-CDC0-A81D-345F-160C-F8DC-DBB7` match the existing product build policy and `KEY-FINGERPRINT.txt`. This is evidence of matching the recorded reference, not independent evidence that this is the operator-approved key for every existing licence. The builder validates both the supplied and staged public key. The final EXE has not yet been inspected.

## Verification and safety boundary

Windows run `40855075398` could not list either the candidate diagnostic installer or a small separately compiled Inno probe with the runner's 7z. That does not prove either executable corrupt. The exact released EXE was not uploaded and is unavailable for separate examination. The limited PE structural checker added here validates PE headers and section boundaries, size and hash only; it cannot establish Inno metadata, payload completeness, absence of sensitive contents, or successful installation.

The product-mode packaging probe `40858823858` on `1acf98c1930618bad5a89e6d3a487bfe35d216d0` built `KAYAN-ERP-Setup.exe` and passed the limited PE structural check (x86 loader; 155714907 bytes; SHA-256 `c1150822c3b474b81787094d103d1cd81c5969b3233588677c80ce2d90fb352f`). It deliberately has no upload or installation step and failed closed after that check: a compatible trusted Inno payload verifier and sensitive-content scan are still required. Its compiler file-version metadata returned `0.0.0.0`, so the compiler version is not established. The EXE is not available as an artifact and cannot be examined independently.

The attempt to skip the full preflight for this packaging-only push did **not** work: run `40858823864` repeated previously successful checks. A cancellation attempt returned GitHub HTTP 403; the run continued. Product licensing, corruption recovery, and upgrade remain untested on a real isolated Windows installation.
