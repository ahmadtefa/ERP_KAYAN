# The demo backup file

A ready-made ERP KAYAN company you can put into your own copy of the program
with one button. Everything in it is invented: the company, the branches, the
people, the customers, the suppliers and every number. It exists so that the
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

## 1. Getting the file

1. Open the **Actions** tab of the repository.
2. Choose **Demo backup file** in the list on the left.
3. Open the newest successful run (green tick).
4. Under **Artifacts**, download **kayan-demo-backup**.

The download is a small ZIP containing:

| File | What it is |
| --- | --- |
| `kayan-demo-backup-<date>.dump` | the backup itself |
| `SHA256SUMS.txt` | its fingerprint, so you can check the download arrived whole |

On Linux or macOS: `sha256sum -c SHA256SUMS.txt`. On Windows PowerShell:
`Get-FileHash .\kayan-demo-backup-<date>.dump -Algorithm SHA256`.

Artifacts are kept for 90 days. If you need one after that, re-run the
workflow: **Actions → Demo backup file → Run workflow**.

### Building it yourself

```bash
cd backend
npm install
npx prisma generate
npm run build
npm run build:demo          # writes backend/dist-demo/kayan-demo-backup-<date>.dump
```

`build:demo` needs `psql` and `pg_restore` on the `PATH`, and a PostgreSQL
server it may create and drop two throwaway databases on. Tell it which one
with `DATABASE_URL`, `KAYAN_RESTORE_URL` and `ADMIN_DATABASE_URL`. It never
touches the database your program is actually running on: both databases it
uses are named by the script and dropped when they are no longer needed.

---

## 2. What is in it

One company, three branches, two financial years, and a full year of trade.

**The company** — Al Nakheel Trading & Distribution
(النخيل للتجارة والتوزيع), code `NAKHEEL`, Egyptian pounds, with a logo,
an address, a tax number and three branches:

| Code | Branch | Arabic |
| --- | --- | --- |
| `MAIN` | Head Office — Dokki | المركز الرئيسي — الدقي |
| `ALX` | Alexandria Branch | فرع الإسكندرية |
| `MNS` | Mansoura Branch | فرع المنصورة |

**Sign in with any of these:**

| User name | Password | Can do |
| --- | --- | --- |
| `admin` | `Admin@12345` | everything, including backups and reset |
| `accountant` | `Accountant@12345` | the ledger, the reports, the day books |
| `sales` | `Sales@12345` | customers, sales invoices, the catalogue |

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

## 3. Format and compatibility

| | |
| --- | --- |
| Format | PostgreSQL Custom archive, made by `pg_dump -Fc` |
| First five bytes | `PGDMP` |
| Produced with | PostgreSQL 16 |
| Needs | PostgreSQL 14 or newer; `pg_restore` no older than the server |
| Typical size | about 150 KB |

This is the format the program understands. The Restore screen reads an upload
with `pg_restore --list` before it will accept it, so a CSV, an Excel file, a
JSON collection, a plain SQL script or a folder copy will be refused with a
message — and a corrupt or truncated archive will be refused too.

A full backup holds **the whole database**, not one company. Restoring one
replaces every company and every user on that server. That is why the screen
makes you confirm, and why the section below matters.

---

## 4. Restoring it — read this first

> **A full restore replaces everything.** Every company, every user, every
> invoice and every setting on that database is gone and replaced by what is
> in the file. There is no undo.

Before you restore anywhere:

1. **Take a backup of what you have now.** Settings → Backup → *Take full
   backup*, then download it and keep it somewhere else.
2. **Try it on a copy first, if there is anything you care about.** The
   instruction in the program's own documentation is that a restore is only
   safe when nothing of value can be lost — a spare machine, a second
   database, or a scratch installation.
3. **Do not restore into a database you are relying on** just to see whether
   the demo works.

To restore it:

1. Sign in as `admin`.
2. Go to **Settings → Backup → Restore backup**.
3. Choose the file, type the confirmation the screen asks for, and confirm.

What then happens, in order:

1. The file is read with `pg_restore --list`. If it is not a real archive, it
   is refused here and nothing else moves.
2. It is restored into a scratch database the program creates for the purpose.
   If that fails, the file is rejected and your data is untouched.
3. A safety backup of your current database is taken.
4. Writes are blocked for a moment, the file is restored over the database,
   and the safety copy is put back automatically if anything goes wrong.
5. The restored data is checked: the tables have to be there and the entries
   have to agree with their own lines. If they do not, the safety copy is put
   back.

You cannot start this by accident. The route refuses a request without
`confirm=true`, the screen makes you type a confirmation before it sends one,
and a second restore cannot start while the first is running.

### After restoring the demo

You are signed in as nobody — sign in again with `admin` / `Admin@12345`. The
company setup is already marked complete, so you go straight into a working
company. Change the passwords before this is anywhere near anything real; they
are published here.

---

## 5. How the file is checked before it is published

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
