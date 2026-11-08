# Arabic RTL screenshot baselines

These are 1440×900 synthetic widget-test renders, reviewed from the current
screens, not copied from the older `869d767` design screenshots. The renders
use Flutter 3.47.6 on Ubuntu 24.04, the bundled IBM Plex Arabic fonts, the
Flutter SDK Material icon font, and a decoded local logo. The test verifies
representative fixture values and that the active navigation item is visible.
It does not exercise a live backend, Windows rendering, PDFs, or licensing.

The files were reconstructed losslessly from the diagnostic check runs for
commit `8ea5244`. Before storing them, their decoded RGBA SHA-256 values were
checked against the hashes calculated on the runners:

| File | SHA-256 of 1440×900 RGBA pixels |
| --- | --- |
| dashboard_ar.png | `414713ca51e47696ede738979181ecd6f8c91c5ebcc63b1ff8e220489741ecaf` |
| customers_ar.png | `46ed6ceb83420fdf06f738bf8fb0a136a72254fc56cb74de154e0e306a2a764c` |
| sales_invoices_ar.png | `f43633ac135b553f00384bbc6fe5877ba299c470583687d07498d5f71140b7fc` |

A change to fonts, rendering engine, platform, layout or fixtures can change
these pixels. Review full-resolution before/after images and the associated
behaviour before changing a baseline; never update it just to make CI pass.

## Order navigation addition — 0a5bcc0

The independently rendered check runs on `0a5bcc0` were reconstructed
losslessly and reviewed against the previous images. Dashboard and customer
screens differ only in the sidebar scrollbar thumb (160 pixels each); the
sales invoice screenshot changes the sidebar scroll position to keep the
selected invoice and the new sales-order entry visible. The invoice body and
fixture values remain unchanged. This review does not verify order operations,
Windows rendering, backend integration, or product readiness.

| File | SHA-256 of updated 1440×900 RGBA pixels |
| --- | --- |
| dashboard_ar.png | `5398be343a40c369d41608e219b8d8f10f5290a4fc50a44fcf51a93697c1ccc3` |
| customers_ar.png | `bdcbfd05f9e28b4e105e3e9f378e6de1d008ed380ca097c8cc3ae3a79c13c1f4` |
| sales_invoices_ar.png | `2891d330457dfae15144cbea9443ee9ce994144d9064ab6f4bb2dedda3a2a567` |

## Additional Home shortcut — 6993250

The independent full-resolution synthetic renders from [run 41836178565](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41836178565) were reconstructed losslessly and reviewed against the prior baselines. Each image changes exactly 132 pixels within x=165–182, y=23–37: the added Home icon. The sidebar dashboard entry and the rest of each image remain pixel-identical. This review does not establish product approval, live backend integration, or Windows rendering. The Home navigation widget test remains the behavioral check.

| File | SHA-256 of updated 1440×900 RGBA pixels |
| --- | --- |
| dashboard_ar.png | `e9b3c65c1c8c3cfdd20a6950e3617965c7e564e4e4b9c02ca950c0831c8f2669` |
| customers_ar.png | `6486fff6ea6c1053988fb13dc2725a413480aa17bea786201b3d0f4ecdcb5164` |
| sales_invoices_ar.png | `2eb540e2d12bf4ed5eb9af8b0a8e1834eac820e1065601fc7efe8dd73ef6bc27` |

## Invoice-list refresh action — a717d43

The sales-invoice screenshot was reviewed against the failed render. Its changed
header region shows the new manual refresh button and the corresponding shift of
the new-invoice button; the table, navigation, and remaining screen are
unchanged. The dashboard and customer baselines remain unchanged.

| File | SHA-256 of updated 1440×900 RGBA pixels |
| --- | --- |
| sales_invoices_ar.png | `daf92fd3ce55dc6c01c8f93852e4d2d7d5bf36d42d4b7510a73e63a899e4f00e` |

## Inventory navigation — d2cbf1d

`d2cbf1d` added nine entries to the sidebar (stock documents, inventory reports,
storage locations, warehouses, item thresholds, batches, stock takes, write-offs
and storage-location permissions), which grew the navigation list from 27 to 36
items. The baselines were never re-rendered after that change, so the screenshot
job failed on dashboard and customers with a 502-pixel difference.

The failed renders were reconstructed losslessly from the diagnostic check run
for `f6ae4591` and compared to the previous baselines. In both images all 502
differing pixels fall inside x=1192–1197, y=357–441: a six-pixel-wide vertical
strip on the border of the navigation rail. That is the scrollbar thumb. The
thumb no longer reaches the same y range because the navigation list is now
longer, so those pixels show the rail background instead of the thumb. Every
other pixel — the whole screen body, the figures, and the rest of the rail — is
identical.

`sales_invoices_ar.png` passes with the previous baseline and was left alone.

| File | SHA-256 of updated 1440×900 RGBA pixels |
| --- | --- |
| dashboard_ar.png | `d5048ef08fe9ba1a6bd074834b54feced5cb6d43a9ba839b36dfe09d37955b5b` |
| customers_ar.png | `793f033a2e9b7cc2f54e6012cd46fc60dca7a8a88185fd4ab064785a3743f238` |

Every pixel outside the navigation scrollbar thumb is unchanged from the
previous baselines; this review does not verify order operations, Windows
rendering, backend integration, or product readiness.
