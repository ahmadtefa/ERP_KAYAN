# KAYAN ERP — Final acceptance checklist

This checklist is the **manual trial handoff** after automated CI. Run it with a
fresh test company and test data only. Do not use live company records until the
checks pass and the business decisions listed in the README have been approved.

## 1. Confirm the exact build

- [ ] Confirm the Git commit/PR being tested is the one whose CI passed.
- [ ] Download the Windows x64 installer from a successful **Windows Installer**
      GitHub Actions run, or build/run the intended platform from that same commit.
- [ ] Record the installer/build version and SHA-256 hash if distributing it.
- [ ] Verify the target computer meets the Windows/PostgreSQL requirements in
      [DESKTOP_WINDOWS.md](./DESKTOP_WINDOWS.md).
- [ ] Make a backup before testing restore or migration scenarios.

## 2. First run and company setup

- [ ] Start with an empty **test** database and complete first-run administrator
      creation.
- [ ] Confirm the company profile, currency, branch, fiscal year, and chart of
      accounts are correct.
- [ ] Sign out and sign in again; restart the application and confirm the session
      behavior is expected.
- [ ] Switch Arabic/English and verify labels, right-to-left layout, dates, and
      currency formatting.

## 3. Permissions and tenant isolation

- [ ] Create a normal user and assign the intended role.
- [ ] Confirm allowed screens/actions work and forbidden API operations return
      an authorization error (hiding a button alone is not sufficient).
- [ ] Disable a user or remove a role grant and confirm access is revoked.
- [ ] If multiple companies/branches are configured, verify users cannot read or
      modify data outside their authorized company/branch.

## 4. Core accounting flow

- [ ] Create a balanced draft journal entry; verify debit equals credit.
- [ ] Attempt an unbalanced entry and confirm it is rejected by the server.
- [ ] Post the balanced entry and verify it appears in the ledger and reports.
- [ ] Reverse the posted entry and verify a mirror reversal is created exactly
      once; the original remains auditable and cannot be edited.
- [ ] Verify trial balance debits equal credits and inspect the ledger, trial
      balance, profit and loss, and account statement for the test period.
- [ ] Confirm closed-period restrictions before relying on fiscal closing.

## 5. Sales, purchasing, and inventory

- [ ] Create a customer, supplier, stock item, and opening/purchase stock.
- [ ] Create a draft purchase invoice and confirm it does not affect stock or GL.
- [ ] Post the purchase invoice and verify stock quantity, cost, and accounting.
- [ ] Create a draft sales invoice and confirm it does not affect stock or GL.
- [ ] Post the sales invoice and verify stock decreases, cost of goods sold and
      revenue are posted, and customer balance is correct.
- [ ] Try selling more than available stock; the server should reject it.
- [ ] Reverse a posted sale and purchase; verify stock and accounting are
      restored correctly and the documents cannot be reversed twice.
- [ ] Verify weighted-average cost and historical invoice costs remain stable
      after later purchases.
- [ ] If practical, submit two posting/reversal requests close together and
      confirm there are no duplicate journal entries or stock movements.

## 6. Data management and outputs

- [ ] Import a small customer/supplier/item CSV or Excel file; review the preview
      before committing and test duplicate/invalid rows.
- [ ] Export the same list and compare row counts and values.
- [ ] Export reports to XLSX/CSV/PDF where available; check totals and Arabic
      text/direction.
- [ ] Print a report or save it as PDF.
- [ ] Create a backup, restore it into an isolated test database, and verify
      company records, balances, and sign-in. Never test restore on the only
      copy of real data.
- [ ] Check audit history for sign-in, create, post, and reverse operations.

## 7. Runtime and recovery

- [ ] Restart the API/application and confirm test data persists.
- [ ] Stop the database temporarily and verify the application reports a clear
      connection failure instead of displaying misleading success.
- [ ] Confirm logs are accessible and contain no passwords, JWT secrets, or
      other credentials.
- [ ] Verify backup files can be stored outside the computer being tested.

## Sign-off

Record the build/commit, machine/OS, database version, tester, date, failed
checks, and screenshots/log excerpts that do not expose secrets.

- [ ] All critical checks passed.
- [ ] Known limitations and accounting policy choices have been accepted by the
      business owner.
- [ ] A verified backup exists before production use.

**Important:** passing automated CI confirms the checks it runs; it does not
prove that every workflow above has been manually accepted. Do not mark the
application production-ready until this checklist is completed.
