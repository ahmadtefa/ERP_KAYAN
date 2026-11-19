# Golden review material — commit 3be9379b

Reconstructed losslessly from the check-run annotations of workflow run
42857641633 (safe-checks), jobs 129974925290 / 129974925274 / 129974925313.

Every file here was verified by hashing the decoded 1440x900 RGBA pixels and
comparing with the hash the runner published before uploading. Three of three
matched, so these are the pixels the runner drew, not a re-render.

## What changed, and why it is the accordion

| screen | differing pixels | % of image | differing columns |
| --- | --- | --- | --- |
| dashboard_ar | 18,273 | 1.41% | x=1192..1421 |
| customers_ar | 40,154 | 3.10% | x=1192..1429 |
| sales_invoices_ar | 41,395 | 3.19% | x=1191..1429 |

In this RTL layout the navigation sidebar occupies x=1150..1439. **Zero**
pixels differ in the content area (x < 1191) on any of the three screens.

The before/after strips show the same eight sections in the same order, with
the same entries belonging to each: the old menu drew every section expanded
and scrolled the sidebar to the selected row; the new menu draws the eight
headings with only the section owning the current screen expanded.

- dashboard: before showed overview + accounting + parties + inventory entries;
  after shows overview (open) and the seven other headings closed.
- customers: same, with the parties section open on the customers row.
- sales_invoices: before the sidebar was scrolled down to show the selected
  invoice row among every entry; after the sales section is expanded in place.

No colour, type, spacing, RTL direction or content-region change is present.

## Why these are not committed as goldens yet

The owner's instruction is that a baseline is replaced only after review, never
to make CI green. These files are that review material. Committing them is a
separate, explicit decision.
