// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'KAYAN ERP';

  @override
  String get signIn => 'Sign In';

  @override
  String get signOut => 'Sign Out';

  @override
  String get username => 'Username';

  @override
  String get password => 'Password';

  @override
  String get usernameRequired => 'Username is required';

  @override
  String get passwordRequired => 'Password is required';

  @override
  String get invalidCredentials => 'Invalid username or password';

  @override
  String get unexpectedError => 'An unexpected error occurred';

  @override
  String get networkError =>
      'Cannot reach the server. Check your connection or the API address.';

  @override
  String get loading => 'Loading…';

  @override
  String get retry => 'Retry';

  @override
  String get noData => 'No data to display';

  @override
  String get welcomeBack => 'Welcome back';

  @override
  String get dashboard => 'Dashboard';

  @override
  String get chartOfAccounts => 'Chart of Accounts';

  @override
  String get journalEntries => 'Journal Entries';

  @override
  String get sales => 'Sales';

  @override
  String get purchases => 'Purchases';

  @override
  String get inventory => 'Inventory';

  @override
  String get reports => 'Reports';

  @override
  String get settings => 'Settings';

  @override
  String get language => 'Language';

  @override
  String get arabic => 'العربية';

  @override
  String get english => 'English';

  @override
  String get systemDefault => 'System default';

  @override
  String get appearance => 'Appearance';

  @override
  String get signedInAs => 'Signed in as';

  @override
  String get company => 'Company';

  @override
  String get branch => 'Branch';

  @override
  String get notAvailable => 'Not set';

  @override
  String get version => 'Version';

  @override
  String get about => 'About';

  @override
  String get aboutDescription =>
      'KAYAN ERP — cross-platform enterprise resource planning client.';

  @override
  String get quickAccess => 'Quick access';

  @override
  String get moduleComingSoon => 'This module is not available yet.';

  @override
  String get accountsTotal => 'Accounts';

  @override
  String get accountCode => 'Code';

  @override
  String get accountName => 'Account name';

  @override
  String get accountType => 'Type';

  @override
  String get typeAsset => 'Assets';

  @override
  String get typeLiability => 'Liabilities';

  @override
  String get typeEquity => 'Equity';

  @override
  String get typeRevenue => 'Revenue';

  @override
  String get typeExpense => 'Expenses';

  @override
  String get searchAccounts => 'Search by code or name';

  @override
  String get noAccounts => 'No accounts found';

  @override
  String get postable => 'Postable';

  @override
  String get grouping => 'Group';

  @override
  String get unbalancedEntry =>
      'Journal entry is not balanced (debits must equal credits)';

  @override
  String get sampleDataNotice =>
      'Development sample data — no backend is connected yet.';

  @override
  String get sampleDataDetail =>
      'These records are generated locally for interface development. They are not stored and are not a system of record.';

  @override
  String get pendingDecisions => 'Pending business decisions';

  @override
  String get customers => 'Customers';

  @override
  String get suppliers => 'Suppliers';

  @override
  String get customer => 'Customer';

  @override
  String get supplier => 'Supplier';

  @override
  String get newCustomer => 'New customer';

  @override
  String get newSupplier => 'New supplier';

  @override
  String get editCustomer => 'Edit customer';

  @override
  String get editSupplier => 'Edit supplier';

  @override
  String get noCustomers => 'No customers yet';

  @override
  String get noSuppliers => 'No suppliers yet';

  @override
  String get searchParties => 'Search by code or name';

  @override
  String get phone => 'Phone';

  @override
  String get email => 'Email';

  @override
  String get taxNumber => 'Tax number';

  @override
  String get address => 'Address';

  @override
  String get creditLimit => 'Credit limit';

  @override
  String get creditLimitNote =>
      'Recorded for reference. Enforcing it is a policy decision that has not been made yet.';

  @override
  String get partyInactive => 'Inactive — cannot be used on new invoices';

  @override
  String get items => 'Items';

  @override
  String get item => 'Item';

  @override
  String get newItem => 'New item';

  @override
  String get editItem => 'Edit item';

  @override
  String get noItems => 'No items yet';

  @override
  String get searchItems => 'Search by code or name';

  @override
  String get unit => 'Unit';

  @override
  String get salePrice => 'Sale price';

  @override
  String get costPrice => 'Cost price';

  @override
  String get isStockTracked => 'Stock tracked';

  @override
  String get stockTracked => 'Stocked';

  @override
  String get stockNotTracked => 'Service / not stocked';

  @override
  String get noStock => 'No stock on hand';

  @override
  String get stock => 'Stock';

  @override
  String get stockBalances => 'Stock balances';

  @override
  String get onHand => 'On hand';

  @override
  String get averageCost => 'Average cost';

  @override
  String get stockValue => 'Value';

  @override
  String get itemLedger => 'Item ledger';

  @override
  String get movements => 'Movements';

  @override
  String get direction => 'Direction';

  @override
  String get movementIn => 'Receipt';

  @override
  String get movementOut => 'Issue';

  @override
  String get runningBalance => 'Running balance';

  @override
  String get reference => 'Reference';

  @override
  String get noMovements => 'No movements yet';

  @override
  String get totalQuantity => 'Total quantity';

  @override
  String get totalValue => 'Total value';

  @override
  String get salesInvoices => 'Sales invoices';

  @override
  String get purchaseInvoices => 'Purchase invoices';

  @override
  String get newSalesInvoice => 'New sales invoice';

  @override
  String get newPurchaseInvoice => 'New purchase invoice';

  @override
  String get invoiceNumber => 'Number';

  @override
  String get invoiceDate => 'Date';

  @override
  String get dueDate => 'Due date';

  @override
  String get invoiceLines => 'Lines';

  @override
  String get addLine => 'Add line';

  @override
  String get removeLine => 'Remove';

  @override
  String get line => 'Line';

  @override
  String get description => 'Description';

  @override
  String get lineDescription => 'Description';

  @override
  String get quantity => 'Quantity';

  @override
  String get unitPrice => 'Unit price';

  @override
  String get taxRate => 'Tax %';

  @override
  String get lineTotal => 'Line total';

  @override
  String get subTotal => 'Subtotal';

  @override
  String get taxAmount => 'Tax';

  @override
  String get totalAmount => 'Total';

  @override
  String get paidAmount => 'Paid';

  @override
  String get remaining => 'Remaining';

  @override
  String get costOfGoods => 'Cost of goods';

  @override
  String get grossProfit => 'Gross profit';

  @override
  String get supplierReference => 'Supplier reference';

  @override
  String get noSalesInvoices => 'No sales invoices yet';

  @override
  String get noPurchaseInvoices => 'No purchase invoices yet';

  @override
  String get post => 'Post';

  @override
  String get reverse => 'Reverse';

  @override
  String get posted => 'Posted';

  @override
  String get draft => 'Draft';

  @override
  String get reversed => 'Reversed';

  @override
  String get confirmPost =>
      'Post this document? Stock and the ledger will be updated and it cannot be edited afterwards.';

  @override
  String get confirmReverse =>
      'Reverse this document? The original stays in the books and a mirror entry cancels it.';

  @override
  String get invoicePosted => 'Invoice posted';

  @override
  String get invoiceReversed => 'Invoice reversed';

  @override
  String get invoiceSaved => 'Draft saved';

  @override
  String get posting => 'Posting…';

  @override
  String get reversing => 'Reversing…';

  @override
  String get invoiceDetails => 'Invoice details';

  @override
  String get lines => 'Details';

  @override
  String get selectCustomer => 'Select a customer';

  @override
  String get selectSupplier => 'Select a supplier';

  @override
  String get selectItem => 'Select an item';

  @override
  String get search => 'Search';

  @override
  String get actions => 'Actions';

  @override
  String get viewDetails => 'Details';

  @override
  String get addLineFirst => 'Add at least one line';

  @override
  String get partyRequired => 'A customer is required';

  @override
  String get supplierRequired => 'A supplier is required';

  @override
  String get trialBalance => 'Trial balance';

  @override
  String get profitAndLoss => 'Profit and loss';

  @override
  String get customerBalances => 'Customer balances';

  @override
  String get supplierBalances => 'Supplier balances';

  @override
  String get accountLedger => 'Account ledger';

  @override
  String get from => 'From';

  @override
  String get to => 'To';

  @override
  String get asOf => 'As at';

  @override
  String get account => 'Account';

  @override
  String get opening => 'Opening';

  @override
  String get closing => 'Closing';

  @override
  String get debit => 'Debit';

  @override
  String get credit => 'Credit';

  @override
  String get balance => 'Balance';

  @override
  String get revenue => 'Revenue';

  @override
  String get expenses => 'Expenses';

  @override
  String get netProfit => 'Net profit';

  @override
  String get totals => 'Totals';

  @override
  String get difference => 'Difference';

  @override
  String get balanced => 'The ledger balances';

  @override
  String get outOfBalance => 'The ledger does not balance';

  @override
  String get runReport => 'Run';

  @override
  String get noBalances => 'No balances in this range';

  @override
  String get accountRequired => 'Choose an account first';

  @override
  String get period => 'Period';

  @override
  String get allBranches => 'All branches';

  @override
  String get newJournalEntry => 'New journal entry';

  @override
  String get entryNumber => 'Entry number';

  @override
  String get noEntries => 'No journal entries yet';

  @override
  String get postEntry => 'Post';

  @override
  String get entryPosted => 'Entry posted';

  @override
  String get entryReversed => 'Entry reversed';

  @override
  String get entryUnbalanced => 'Debits and credits must be equal';

  @override
  String get entryNeedsTwoLines => 'An entry needs at least two lines';

  @override
  String get journalDeleted =>
      'A posted entry is corrected by reversing it, never by editing';

  @override
  String get add => 'Add';

  @override
  String get edit => 'Edit';

  @override
  String get save => 'Save';

  @override
  String get cancel => 'Cancel';

  @override
  String get close => 'Close';

  @override
  String get deactivate => 'Deactivate';

  @override
  String get activate => 'Reactivate';

  @override
  String get active => 'Active';

  @override
  String get inactive => 'Inactive';

  @override
  String get confirm => 'Confirm';

  @override
  String get searchHint => 'Search…';

  @override
  String get createdSuccessfully => 'Saved successfully';

  @override
  String get operationFailed => 'The operation could not be completed';

  @override
  String get requiredField => 'This field is required';

  @override
  String get invalidNumber => 'Enter a valid number';

  @override
  String get mustBePositive => 'Enter a number greater than zero';

  @override
  String get editInline => 'Edit';

  @override
  String get noPermission => 'You do not have permission to do this';

  @override
  String get loading_data => 'Loading…';

  @override
  String get status => 'Status';

  @override
  String get users => 'Users';

  @override
  String get administration => 'Administration';

  @override
  String get auditTrail => 'Audit trail';

  @override
  String get newUser => 'New user';

  @override
  String get editUser => 'Edit user';

  @override
  String get usernameHelper =>
      'This is the name used to sign in. \"admin\" is reserved.';

  @override
  String get fullNameEn => 'Name in English';

  @override
  String get fullNameAr => 'Name in Arabic';

  @override
  String get passwordHelper => 'At least 12 characters.';

  @override
  String get changePassword => 'Change password';

  @override
  String get passwordChanged =>
      'Password changed, and the old sessions were ended.';

  @override
  String get confirmDeactivateUser =>
      'This user will no longer be able to sign in. Continue?';

  @override
  String get searchUsers => 'Search users…';

  @override
  String get noUsers => 'No users';

  @override
  String get lastLogin => 'Last sign-in';

  @override
  String get never => 'Never signed in';

  @override
  String get superAdmin => 'Super administrator';

  @override
  String get roles => 'Roles';

  @override
  String get newRole => 'New role';

  @override
  String get editRole => 'Edit role';

  @override
  String get roleCode => 'Code';

  @override
  String get noRoles => 'No roles';

  @override
  String get systemRole => 'Built-in';

  @override
  String get customRole => 'Custom';

  @override
  String get deleteRole => 'Delete role';

  @override
  String get confirmDeleteRole => 'This role will be removed. Continue?';

  @override
  String get permissions => 'Permissions';

  @override
  String get setPermissions => 'Edit permissions';

  @override
  String get permissionsNote =>
      'A built-in role: its permissions can be changed, but it cannot be renamed or removed.';

  @override
  String get action => 'Action';

  @override
  String get entity => 'Entity';

  @override
  String get when => 'When';

  @override
  String get by => 'By';

  @override
  String get noAuditLogs => 'Nothing has been recorded yet';

  @override
  String get refresh => 'Refresh';

  @override
  String get fiscalPeriods => 'Fiscal periods';

  @override
  String get newPeriod => 'New period';

  @override
  String get editPeriod => 'Edit period';

  @override
  String get periodCode => 'Code';

  @override
  String get startDate => 'Start date';

  @override
  String get endDate => 'End date';

  @override
  String get open => 'Open';

  @override
  String get closed => 'Closed';

  @override
  String get closedOn => 'Closed on';

  @override
  String get closePeriod => 'Close the period';

  @override
  String get confirmClosePeriod =>
      'After closing, nothing can be posted inside this period — not an invoice and not a manual entry. Continue?';

  @override
  String get periodClosed => 'The period was closed';

  @override
  String get noPeriods => 'No fiscal periods yet';

  @override
  String get dataTools => 'Data';

  @override
  String get importData => 'Import from a file';

  @override
  String get backupTitle => 'Backup and restore';

  @override
  String get exportExcel => 'Excel';

  @override
  String get exportCsv => 'CSV';

  @override
  String get print => 'Print';

  @override
  String get chooseAccountFirst => 'Choose an account first';

  @override
  String get startOver => 'Start over';

  @override
  String get whatAreYouImporting => 'What are you importing?';

  @override
  String get templateFirst => 'Start from the template';

  @override
  String get templateExplains =>
      'The template carries the right columns, an example row and a short explanation of each column.';

  @override
  String get downloadTemplate => 'Download the template';

  @override
  String get importStep1 => 'Download the template';

  @override
  String get importStep2 => 'Fill it in and save it';

  @override
  String get importStep3 => 'Choose the file and read it';

  @override
  String get importStep4 => 'Import for real once it looks right';

  @override
  String get chooseFile => 'Choose the file';

  @override
  String get chooseAnotherFile => 'Choose another file';

  @override
  String get removeFile => 'Remove';

  @override
  String get fileAcceptHint => 'A .xlsx or .csv file, up to 10 MB.';

  @override
  String get readWithoutSaving => 'Read it without saving';

  @override
  String get whatAboutExisting =>
      'What should happen to records that already exist?';

  @override
  String get importModeSkip => 'Leave them alone';

  @override
  String get importModeSkipHint =>
      'A record whose code is already here is skipped and counted. Nothing is changed.';

  @override
  String get importModeUpdate => 'Update them';

  @override
  String get importModeUpdateHint =>
      'The columns the file carries are written over the record. A blank cell changes nothing.';

  @override
  String get readResult => 'What the file contains';

  @override
  String get importResult => 'What was imported';

  @override
  String get rowsInFile => 'Rows in the file';

  @override
  String get willBeAdded => 'Will be added';

  @override
  String get willBeUpdated => 'Will be updated';

  @override
  String get willBeSkipped => 'Already exist';

  @override
  String get columnsNotUnderstood => 'Columns not recognised';

  @override
  String get rowsWithProblems => 'Rows with problems';

  @override
  String get row => 'Row';

  @override
  String get moreRows => 'more rows';

  @override
  String get fixErrorsThenRetry =>
      'Fix these rows in the file and upload it again. Nothing was written from them.';

  @override
  String get importForReal => 'Import for real';

  @override
  String get importDone => 'Imported. The lists now hold these records.';

  @override
  String get takeBackup => 'Take a copy of the data';

  @override
  String get takeBackupHint =>
      'One file holding the whole company: accounts, parties, items, invoices, entries and the audit trail. Move it anywhere, restore it any time.';

  @override
  String get recordsInTotal => 'Records in total';

  @override
  String get downloadBackup => 'Download the backup';

  @override
  String get restoreBackup => 'Restore from a copy';

  @override
  String get restoreWarning =>
      'Restoring replaces everything this company holds with what is in the file. Anything recorded after the copy was taken is lost.';

  @override
  String get restoreChooseFile =>
      'Choose a backup file (.json) that was downloaded from this screen.';

  @override
  String get chooseBackupFile => 'Choose the backup file';

  @override
  String get inspectBackup => 'Read the file first';

  @override
  String get inBackupFile => 'In the file';

  @override
  String get inTheProgramNow => 'In the program now';

  @override
  String get backupTakenAt => 'Taken at';

  @override
  String get backupOtherCompany =>
      'This file belongs to another company. It cannot be restored here.';

  @override
  String get restoreNow => 'Restore now';

  @override
  String get confirmRestoreTitle => 'Replace everything?';

  @override
  String get confirmRestoreBody =>
      'The company\'s data will be replaced with the contents of this file. This cannot be undone. Continue?';

  @override
  String get restoreDone => 'Restored';

  @override
  String get printPdfHint =>
      'Opens a clean page for paper, ready for any printer.';

  @override
  String get exportPdf => 'PDF';

  @override
  String get printHintWhenNoPdf =>
      'Opens a clean page for paper. In the print window, choose \"Save as PDF\" to keep it as a PDF file.';

  @override
  String get downloadList => 'Download the list';

  @override
  String get exportListHint =>
      'Download this list as it stands: Excel, CSV, PDF, or a page to print.';

  @override
  String get rememberLogin => 'Remember sign-in details';

  @override
  String get rememberWebUsernameOnly =>
      'Only the username is saved in this browser.';

  @override
  String get rememberNativeSecure =>
      'Password is stored in device secure storage.';

  @override
  String get newExpenseAccount => 'New expense account';

  @override
  String get editExpenseAccount => 'Edit expense account';

  @override
  String get parentAccount => 'Parent account';

  @override
  String get noParentAccount => 'No parent';

  @override
  String get accountCanPost => 'Can receive journal postings';

  @override
  String get activateAccount => 'Activate account';

  @override
  String get deactivateAccount => 'Deactivate account';
}
