# The demo backup file

> **Historical document — NOT current instructions (PR #70).** The full-dump
> workflow/restore route described below is not available in the current
> release candidate. Full Restore is blocked; a DB-only dump is not a complete
> backup. Do not run the legacy builder or restore commands against a real
> installation. The current repository also has a separate company JSON demo
> download; JSON restore replaces company data and is not Full Restore. See
> [current backup safety](BACKUP_RESTORE.md) and the dated release review.


The historical sample described below was an invented ERP KAYAN company.
The former one-button full-dump restore is now blocked. The company, branches,
people, customers, suppliers and numbers described below were invented. It existed so that the
screens, the lists, the reports and the exports have something real-looking to
show, and so that a new installation can be tried without typing in a chart of
accounts by hand.

- **What it is:** one PostgreSQL Custom-format archive, `kayan-demo-backup-<date>.dump`
- **Where it comes from:** the program's own *Take full backup* button — the
  same code path you use, not a copy of a folder and not a script
- **How it goes in:** the program's own *Restore backup* screen
- **Where to get it:** it is not in the repository. The **Demo backup file**
  workflow builds it on every push and attaches it to the run

---

## 1. Current availability

The historical workflow artifact is not current release evidence. The current
source exposes a separate company JSON demo download when packaged; it can be
absent and returns an error in that case. It is not a PostgreSQL full-machine
archive. Do not use this demo on a company with real data.

---

## 2. Historical sample contents

The following describes an old synthetic fixture, not verified current content.
One company, three branches, two financial years, and a full year of trade.

**The company** — Al Nakheel Trading & Distribution
(النخيل للتجارة والتوزيع), code `NAKHEEL`, Egyptian pounds, with a logo,
an address, a tax number and three branches:

| Code | Branch | Arabic |
| --- | --- | --- |
| `MAIN` | Head Office — Dokki | المركز الرئيسي — الدقي |
| `ALX` | Alexandria Branch | فرع الإسكندرية |
| `MNS` | Mansoura Branch | فرع المنصورة |

Historical demo credentials are not appropriate for customer installations;
never use a demo account or default password in production.

**What there is to look at:**

| | Rows | Notes |
| --- | --- | --- |
| Chart of accounts | 46 | 15 assets, 9 liabilities, 4 equity, 5 revenue, 13 expenses — parents and postable children, in both languages |
| Financial years | 2 | `FY2025` closed, `FY2026` open with its twelve periods |
| Journal entries | 163 | 490 lines; every one posted, and every one agrees with its own lines |
| Customers | 14 | with credit limits, tax numbers, phone numbers, Egyptian cities |
| Suppliers | 9 | the same, for the buying side |
| Items | 30 | units of measure, barcodes, sale prices, VAT rates, some non-stock items |
| Stock balances | 90 | one row per item per branch |
| Stock movements | 266 | opening, purchase-in, sale-out and sale-returns |
| Sales invoices | 46 | 120 lines; posted, with a few drafts and two reversed credit notes |
| Purchase invoices | 20 | 66 lines; posted, with two drafts and a reversed one |
| Document sequences | 5 | journal, sales, purchases, and both returns |
| Users, roles, permissions | 3 / 3 / 31 | the full permission catalogue |
| Audit log | 5 | sign-ins, postings, a restore |

**The year it depicts.** A set of opening balances carried forward from the
closed 2025 year, then 2026: twenty purchase invoices stocking the warehouse,
forty-six sales invoices selling it again with VAT and cost of goods, cash
receipts against customer invoices, payments to suppliers, cash counted into
the bank, nine months of rent, salaries, electricity, fuel and depreciation,
quarterly VAT settlements, and a reversal or two where someone got something
wrong and corrected it.

The books balance. Total debits equal total credits to the penny, and the
trial balance difference is zero — this is asserted every time the file is
built, and again after the file has been restored.

### What is not in it, and why

The requirements ask for warehouses, item categories, quotations, sales
orders, purchase orders, returns documents, cash books and payment terms. The
program's own tables do not have those as separate things yet, so the demo
expresses them the way the program does:

- **Warehouses** are the three branches; stock is held per branch.
- **Item categories** are a prefix on the item code and the item notes.
- **Quotations and orders** are invoices left in `DRAFT` — three sales and two
  purchases are deliberately left unposted for this.
- **Returns** are invoices with status `REVERSED`, plus stock movements of
  reference type `SALES_RETURN` that put the goods back on the shelf.
- **Payment terms** are the `dueDate` on each invoice.
- **Cash, banks and the cash book** are accounts `1101` (petty cash), `1102`
  (CIB current account) and `1103` (QNB current account) in the chart.
- **Receipts, payments and transfers** are their own journal entries, with
  descriptions such as *Receipt for SINV-2026-0007*.

Nothing has been invented for the sake of the demo: no table, column, enum or
status that the migrations do not already make.

---

## 3. Compatibility

Historical `.dump` examples are database archives, not complete backups. The
current company demo uses a separate JSON format; neither format proves a full
machine restore. Verify the exact format and capabilities of the running
version and keep demo data isolated from real company data.

---

## 4. Restore status

The full-dump restore described in historical versions is blocked. Do not
restore a demo into a company or server containing valuable data. A separate
company JSON restore exists but is destructive, is not complete machine
recovery, and is not a substitute for a verified full backup. No production
restore procedure is approved by this document.

---

## 5. Historical build checks (not evidence for current HEAD)

The historical steps below are retained as design history only. They are not
approval to run the old builder, and the HTTP endpoints they describe do not
work as stated on this PR. No current artifact or installed-product result is
claimed.

`backend/scripts/build-demo-backup.mjs` builds the file and refuses to finish
unless all of this passes:

1. a throwaway database is created and **every real migration** is applied to
   it — nothing is hand-made;
2. the demo company is built into it, and the builder refuses to write an
   unbalanced entry;
3. the API is started against it and asked **over HTTP**, with a real admin
   sign-in, to take a full backup — the same call the Backup screen makes;
4. the archive is read back with `pg_restore --list`;
5. the file is downloaded and its `PGDMP` signature checked;
6. the trial balance is fetched and its difference must be zero;
7. a **second** throwaway database is created, and the exact file is restored
   into it through the restore route;
8. after that restore: the company can be signed into, the accounts, journal
   entries, sales, purchases, customers, suppliers, items, stock and periods
   are all there, and the trial balance is identical to the one that was
   backed up;
9. a **third** database is created with nothing in it at all — not one
   migration — and the file is put straight into it, to prove the archive
   carries its own tables and indexes and is not merely rows.

Fifteen checks in total. The output of every run is attached to the workflow
run, so the numbers above can be read off it rather than taken on trust.
