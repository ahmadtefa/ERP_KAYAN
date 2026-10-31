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
  String get sessionExpired =>
      'Your session has expired. Sign in again to continue.';

  @override
  String get openingQuantity => 'Opening quantity';

  @override
  String get openingUnitCost => 'Opening unit cost';

  @override
  String get openingStockHint =>
      'Optional. Posts the stock and its inventory/equity entry with the item. Leave blank to enter opening stock later through Opening balances.';

  @override
  String get permissionDenied =>
      'You do not have permission to perform this action.';

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
  String get openingBalancesTitle => 'Opening balances';

  @override
  String get reviewOpeningBalances => 'Review opening balances';

  @override
  String get noOpeningBalanceDocuments => 'No opening-balance drafts yet';

  @override
  String get openingBalanceDraftHint =>
      'Imported opening balances are drafts until you review and post them.';

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
  String get warehouse => 'Warehouse';

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
  String get stockTrackingDoesNotAddQuantity =>
      'Stock tracking does not add quantity. Use Opening balances to enter opening stock, then review and post the draft.';

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
  String get landedCosts => 'Landed costs';

  @override
  String get landedCostAllocationHint =>
      'Add each freight, shipping, duty, or other charge. The total is allocated across stock lines by line value.';

  @override
  String get landedCostCannotBeNegative => 'Landed costs cannot be negative';

  @override
  String get addLandedCost => 'Add charge';

  @override
  String get removeLandedCost => 'Remove charge';

  @override
  String get otherLandedCosts => 'Other landed costs';

  @override
  String get landedCostDescriptionRequired =>
      'Enter a description for each landed-cost charge';

  @override
  String get landedCostAmountInvalid =>
      'Enter a valid non-negative amount for each landed-cost charge';

  @override
  String get editDraftInvoice => 'Edit draft invoice';

  @override
  String get onlyDraftInvoiceCanBeEdited =>
      'Only a draft invoice can be edited';

  @override
  String get salesReturns => 'Sales returns';

  @override
  String get purchaseReturns => 'Purchase returns';

  @override
  String get newSalesReturn => 'New sales return';

  @override
  String get newPurchaseReturn => 'New purchase return';

  @override
  String get noReturns => 'No returns yet';

  @override
  String get returnDate => 'Return date';

  @override
  String get returnReason => 'Return reason';

  @override
  String get originalInvoice => 'Original invoice';

  @override
  String get selectOriginalInvoice => 'Select a posted invoice';

  @override
  String get remainingToReturn => 'Remaining to return';

  @override
  String get quantityToReturn => 'Quantity to return';

  @override
  String get createReturn => 'Create return';

  @override
  String get returnCreated => 'Return saved as a draft';

  @override
  String get confirmPostReturn =>
      'Posting updates stock and the customer or supplier balance. Continue?';

  @override
  String get returnPosted => 'Return posted';

  @override
  String get returnReversed => 'Return reversed';

  @override
  String get returnLines => 'Return lines';

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
  String get selectAll => 'Select all';

  @override
  String get clearAll => 'Clear all';

  @override
  String get extraPermissions => 'Extra permissions';

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
  String get fixedAssets => 'Fixed assets';

  @override
  String get newAsset => 'New asset';

  @override
  String get editAsset => 'Edit asset';

  @override
  String get assetCode => 'Asset code';

  @override
  String get purchaseDate => 'Purchase date';

  @override
  String get inServiceDate => 'In-service date';

  @override
  String get assetCost => 'Cost';

  @override
  String get salvageValue => 'Salvage value';

  @override
  String get usefulLifeMonths => 'Useful life (months)';

  @override
  String get assetAccount => 'Asset account';

  @override
  String get accumulatedAccount => 'Accumulated depreciation account';

  @override
  String get depreciationExpenseAccount => 'Depreciation expense account';

  @override
  String get fundingAccount => 'Funding account';

  @override
  String get activateAsset => 'Activate (post acquisition)';

  @override
  String get disposeAsset => 'Dispose of asset';

  @override
  String get disposalDate => 'Disposal date';

  @override
  String get disposalProceeds => 'Proceeds';

  @override
  String get proceedsAccount => 'Proceeds account';

  @override
  String get gainLossAccount => 'Gain/loss account';

  @override
  String get runDepreciation => 'Run depreciation';

  @override
  String get depreciationPeriod => 'Month (YYYY-MM)';

  @override
  String get accumulatedDepreciation => 'Accumulated depreciation';

  @override
  String get bookValue => 'Book value';

  @override
  String get assetCategory => 'Category';

  @override
  String get assetLocation => 'Location';

  @override
  String get noAssets => 'No fixed assets yet.';

  @override
  String get assetDetails => 'Asset details';

  @override
  String get depreciationSchedule => 'Depreciation schedule';

  @override
  String get confirmActivateAsset =>
      'Activation posts the acquisition entry (Dr asset / Cr funding). Continue?';

  @override
  String get confirmDisposeAsset =>
      'Disposal removes the asset from the books and posts its result. Continue?';

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
  String get downloadStatement => 'Download the statement';

  @override
  String get exportStatementHint =>
      'Download this statement as it stands: Excel, CSV, PDF, or a page to print.';

  @override
  String get exportListHint =>
      'Download this list as it stands: Excel, CSV, PDF, or a page to print.';

  @override
  String get newAccount => 'New account';

  @override
  String get editAccount => 'Edit account';

  @override
  String get deleteAccount => 'Delete account';

  @override
  String deleteAccountConfirm(Object account) {
    return 'The account “$account” will be deleted, as long as it has no movements or sub-accounts. Continue?';
  }

  @override
  String get allTypes => 'All types';

  @override
  String get inactiveLabel => 'Inactive';

  @override
  String get accountCodeHelper =>
      'Leave empty to suggest the next code using the chart’s own numbering';

  @override
  String get nameArabic => 'Name in Arabic';

  @override
  String get nameEnglish => 'Name in English';

  @override
  String get parentAccount => 'Parent account';

  @override
  String get parentAccountHelper => 'A sub-account takes its parent’s type';

  @override
  String get noParent => 'No parent (top-level)';

  @override
  String get postableHelper =>
      'A grouping account cannot receive postings; a final account can';

  @override
  String get activeAccount => 'Active';

  @override
  String get rememberMe => 'Remember me';

  @override
  String get rememberMeHint => 'On the web only the username is kept';

  @override
  String get clearSavedCredentials => 'Clear saved sign-in';

  @override
  String get savedCredentialsCleared => 'Saved sign-in details cleared';

  @override
  String get companySettings => 'Company settings';

  @override
  String get companyProfile => 'Company profile';

  @override
  String get companyCode => 'Company code';

  @override
  String get taxId => 'Tax ID';

  @override
  String get companyLogo => 'Company logo';

  @override
  String get uploadLogo => 'Upload logo';

  @override
  String get removeLogo => 'Remove logo';

  @override
  String get logoHint =>
      'Optional — PNG, JPEG or WebP; resized to 1024 × 1024 px, up to 2 MB.';

  @override
  String get logoUpdated => 'Logo updated';

  @override
  String get logoRemoved => 'Logo removed';

  @override
  String get noLogo => 'No logo';

  @override
  String get branches => 'Branches and units';

  @override
  String get newBranch => 'New unit';

  @override
  String get editBranch => 'Edit unit';

  @override
  String get branchCode => 'Unit code';

  @override
  String get branchKind => 'Unit type';

  @override
  String get headquarters => 'Headquarters';

  @override
  String get branchUnit => 'Branch';

  @override
  String get parentUnit => 'Parent unit';

  @override
  String get parentUnitRequired => 'Choose the headquarters or parent unit';

  @override
  String get deleteBranch => 'Delete unit';

  @override
  String deleteBranchConfirm(Object unit) {
    return 'The unit “$unit” will be deleted. Units with movements cannot be deleted.';
  }

  @override
  String get branchSaved => 'Unit saved';

  @override
  String get profileSaved => 'Company details saved';

  @override
  String get unitType => 'Kind';

  @override
  String get fullBackupTitle => 'Full database backup';

  @override
  String get fullBackupDescription =>
      'A complete copy of the whole database (every company and user) in PostgreSQL format. It is made on the server that hosts the database.';

  @override
  String get createFullBackup => 'Create backup now';

  @override
  String backupSavedIn(Object directory) {
    return 'Saved in: $directory';
  }

  @override
  String get backupInProgress => 'Creating the backup…';

  @override
  String get backupFiles => 'Backups on the server';

  @override
  String get deleteBackup => 'Delete backup';

  @override
  String deleteBackupConfirm(Object file) {
    return 'The file “$file” will be permanently removed from the server.';
  }

  @override
  String get restoreFullDatabase => 'Restore the whole database';

  @override
  String get restoreFullWarning =>
      'A full restore replaces everything currently in the database. A safety backup is taken automatically first.';

  @override
  String get uploadDumpFile => 'Upload a backup file (.dump)';

  @override
  String get orChooseServerBackup => 'Or choose a backup on the server';

  @override
  String get confirmFullRestoreTitle => 'Full restore — explicit confirmation';

  @override
  String get confirmFullRestoreBody =>
      'Type RESTORE to confirm. Everything currently in the database will be replaced by the contents of the backup.';

  @override
  String get restoreFullDone => 'Restore completed';

  @override
  String get restoreFullFailed => 'Restore failed';

  @override
  String get fullBackupUnavailable =>
      'PostgreSQL tools (pg_dump / pg_restore) were not found on this server';

  @override
  String get maintenanceActive =>
      'The system is under maintenance — a restore is in progress';

  @override
  String get safetyBackup => 'Safety backup';

  @override
  String get fullBackupKind => 'Full backup';

  @override
  String get createdAtLabel => 'Created';

  @override
  String get sizeLabel => 'Size';

  @override
  String get refreshStatus => 'Refresh status';

  @override
  String get companySettingsHint => 'Name, logo, contact details and branches';

  @override
  String get downloadStarted => 'The file is downloading.';

  @override
  String get downloadFailedTitle => 'The file could not be downloaded.';

  @override
  String get printOpened => 'The print page is opening in a new tab.';

  @override
  String get printBlocked =>
      'The browser blocked the new tab. Allow pop-ups for this address, then press Print again.';

  @override
  String get resetData => 'Reset program';

  @override
  String get resetDataHint =>
      'Clears this company’s books and returns the program to its first run. A backup is taken and checked before anything is deleted, and the reset stops if that backup fails.';

  @override
  String get resetButton => 'Reset program';

  @override
  String get resetOnlyAdmins =>
      'Only an administrator of the program can do this.';

  @override
  String resetForCompany(Object company) {
    return 'This will reset “$company”.';
  }

  @override
  String get resetWhatIsDeleted => 'What will be deleted';

  @override
  String get resetWhatIsKept => 'What is kept';

  @override
  String get resetDeletedHint =>
      'Every record the company holds: its books, its parties, its stock and its documents.';

  @override
  String get resetKeptAdmin =>
      'The administrator account you are signed in with';

  @override
  String get resetKeptPermissions => 'The permission catalogue';

  @override
  String get resetKeptRoles => 'The roles the program ships with';

  @override
  String get resetKeptConfig =>
      'The database connection and the program’s settings';

  @override
  String get resetCountJournalEntries => 'Journal entries';

  @override
  String get resetCountAccounts => 'Accounts';

  @override
  String get resetCountCustomers => 'Customers';

  @override
  String get resetCountSuppliers => 'Suppliers';

  @override
  String get resetCountItems => 'Items';

  @override
  String get resetCountSalesInvoices => 'Sales invoices';

  @override
  String get resetCountQuotations => 'Quotations';

  @override
  String get resetCountCashVouchers => 'Receipts and payments';

  @override
  String get resetCountPurchaseInvoices => 'Purchase invoices';

  @override
  String get resetCountStockMovements => 'Stock movements';

  @override
  String get resetCountFiscalPeriods => 'Financial periods';

  @override
  String get resetCountBranches => 'Branches';

  @override
  String get resetCountUsers => 'Other users';

  @override
  String get resetBackupFirst =>
      'A full backup will be taken and checked before anything is deleted. If the backup cannot be taken, or cannot be read back, nothing is deleted at all.';

  @override
  String get resetConfirmTitle => 'This cannot be undone';

  @override
  String resetConfirmBody(Object word) {
    return 'The only way back is to restore the backup that is about to be taken. Type your password and the word $word to go ahead.';
  }

  @override
  String get resetPasswordLabel => 'Your password';

  @override
  String get resetPasswordHint =>
      'The password of the account you are signed in with. The server checks it.';

  @override
  String resetWordLabel(Object word) {
    return 'Type $word';
  }

  @override
  String resetWrongWord(Object word) {
    return 'Type $word exactly as it is written to confirm.';
  }

  @override
  String resetDone(Object file) {
    return 'The company’s data was cleared. “$file” holds the old data.';
  }

  @override
  String get resetNeedsSetup =>
      'The program will ask to be set up again the next time it is opened.';

  @override
  String get resetPreviewFailed =>
      'What a reset would remove could not be read.';

  @override
  String get cashAndBanks => 'Cash & banks';

  @override
  String get newCashAccount => 'New box or bank';

  @override
  String get cashAccount => 'Box or bank';

  @override
  String get cashBox => 'Cash box';

  @override
  String get bank => 'Bank';

  @override
  String get bankName => 'Bank name';

  @override
  String get iban => 'IBAN';

  @override
  String get ledgerAccount => 'Ledger account';

  @override
  String get noCashAccounts => 'No boxes or banks yet';

  @override
  String get statement => 'Statement';

  @override
  String get vouchers => 'Receipts & payments';

  @override
  String get newVoucher => 'New receipt or payment';

  @override
  String get receipt => 'Receipt';

  @override
  String get payment => 'Payment';

  @override
  String get voucherType => 'Type';

  @override
  String get voucherNumber => 'Number';

  @override
  String get amount => 'Amount';

  @override
  String get noVouchers => 'No receipts or payments yet';

  @override
  String get transfers => 'Transfers';

  @override
  String get newTransfer => 'New transfer';

  @override
  String get fromAccount => 'From';

  @override
  String get toAccount => 'To';

  @override
  String get noTransfers => 'No transfers yet';

  @override
  String get transferNeedsTwoAccounts => 'A transfer needs two boxes or banks';

  @override
  String get party => 'Party';

  @override
  String get saved => 'Saved';

  @override
  String get settleOldestFirst => 'Applied to the oldest open invoices';

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
  String get noParentAccount => 'No parent';

  @override
  String get accountCanPost => 'Can receive journal postings';

  @override
  String get activateAccount => 'Activate account';

  @override
  String get deactivateAccount => 'Deactivate account';

  @override
  String get demoBackupTitle => 'Try the sample company';

  @override
  String get demoBackupHint =>
      'Download a realistic sample company backup, then choose it under Restore. Inspect the preview before replacing any company data.';

  @override
  String get downloadDemoBackup => 'Download sample backup';

  @override
  String get demoLoginHint =>
      'After restoring, sign in with admin / Admin@12345.';

  @override
  String get logoInvalid =>
      'Choose a valid PNG, JPEG or WebP image at least 32 × 32 pixels.';

  @override
  String get logoTooLarge =>
      'The resized logo is still larger than 2 MB. Choose a simpler image.';

  @override
  String get costCenters => 'Cost centers';

  @override
  String get costCenter => 'Cost center';

  @override
  String get newCostCenter => 'New cost center';

  @override
  String get editCostCenter => 'Edit cost center';

  @override
  String get costCenterCode => 'Cost center code';

  @override
  String get costCenterType => 'Cost center type';

  @override
  String get department => 'Department';

  @override
  String get administrativeUnit => 'Administrative unit';

  @override
  String get project => 'Project';

  @override
  String get responsiblePerson => 'Responsible person';

  @override
  String get parentCostCenter => 'Parent cost center';

  @override
  String get searchCostCenters => 'Search cost centers';

  @override
  String get noCostCenters => 'No cost centers yet';

  @override
  String get costCenterSaved => 'Cost center saved';

  @override
  String get costCenterDeactivated => 'Cost center deactivated';

  @override
  String get confirmDeactivateCostCenter =>
      'Deactivating stops new postings. Existing transactions keep their centre. Continue?';

  @override
  String get deleteCostCenter => 'Delete cost center';

  @override
  String get confirmDeleteCostCenter =>
      'Only an unused cost center can be deleted. If it has transactions, deactivate it instead. Continue?';

  @override
  String get costCenterDeleted => 'Cost center deleted';

  @override
  String get allParents => 'All parents';

  @override
  String get allStatuses => 'All statuses';

  @override
  String get usage => 'Usage';

  @override
  String get journalLinesUsing => 'Journal lines';

  @override
  String get allocatedLinesUsing => 'Allocated lines';

  @override
  String get costCenterReport => 'Cost centers';

  @override
  String get ownAmount => 'Own';

  @override
  String get rolledUp => 'Including children';

  @override
  String get unallocated => 'Unallocated';

  @override
  String get transactions => 'Transactions';

  @override
  String get noTransactions => 'No transactions in this period';

  @override
  String get drillDown => 'Details';

  @override
  String get budgets => 'Budgets';

  @override
  String get budget => 'Budget';

  @override
  String get newBudget => 'New budget';

  @override
  String get editBudget => 'Edit budget';

  @override
  String get budgetAmount => 'Budget amount';

  @override
  String get actualAmount => 'Actual';

  @override
  String get variance => 'Variance';

  @override
  String get variancePercent => 'Variance %';

  @override
  String get budgetPeriod => 'Budget period';

  @override
  String get noBudgets => 'No budgets yet';

  @override
  String get budgetSaved => 'Budget saved';

  @override
  String get retireBudget => 'Retire budget';

  @override
  String get confirmRetireBudget =>
      'A retired budget keeps its history and leaves the active list. Continue?';

  @override
  String get budgetReport => 'Budget vs actual';

  @override
  String get favorable => 'Favorable';

  @override
  String get unfavorable => 'Unfavorable';

  @override
  String get budgetRetired => 'Retired';

  @override
  String get allocation => 'Allocation';

  @override
  String get allocations => 'Allocations';

  @override
  String get allocated => 'Allocated';

  @override
  String get sourceAmount => 'Line amount';

  @override
  String get remainingToAllocate => 'Remaining';

  @override
  String get splitAcrossCenters => 'Split across cost centers';

  @override
  String get allocationMustReconcile =>
      'Allocations must add up to the line amount exactly.';

  @override
  String get duplicateCostCenter => 'This cost center is already in the split.';

  @override
  String get selectCostCenter => 'Select a cost center';

  @override
  String get noAllocation => 'No cost center';

  @override
  String get costCenterInactive =>
      'Inactive cost centers cannot receive new postings.';

  @override
  String get addAllocation => 'Add cost center';

  @override
  String get allocationTotal => 'Allocated total';

  @override
  String get deleteRecord => 'Delete';

  @override
  String get resultLabel => 'Result';

  @override
  String get rowDensity => 'Row density';

  @override
  String get densityCompact => 'Compact';

  @override
  String get densityNormal => 'Normal';

  @override
  String get densitySpacious => 'Spacious';

  @override
  String get dragColumnHint => 'Drag a column edge to widen it';

  @override
  String get noRecords => 'Nothing to show';

  @override
  String get resizeDialog => 'Resize';

  @override
  String get maximize => 'Maximize';

  @override
  String get restore => 'Restore';

  @override
  String get availableInBranch => 'Available in branch';

  @override
  String get branchStockHint =>
      'The branch\'s actual on-hand balance, the same figure posting checks. Warehouse-level balances are not tracked.';

  @override
  String get stockNotVisible =>
      'Stock quantities need the inventory.stock.read permission, so they are not shown.';

  @override
  String get useItem => 'Use';

  @override
  String get invoiceDiscount => 'Invoice discount';

  @override
  String get discountBeforeTaxHint =>
      'Applied before tax and allocated across the lines';

  @override
  String get noDiscount => 'No discount';

  @override
  String get discountPercent => 'Percentage';

  @override
  String get discountAmount => 'Fixed amount';

  @override
  String get discountPercentValue => 'Percent %';

  @override
  String get discountAmountValue => 'Amount';

  @override
  String get lineDiscount => 'Line discount';

  @override
  String get beforeDiscount => 'Before discount';

  @override
  String get lineDiscounts => 'Line discounts';

  @override
  String get netLine => 'Net line';

  @override
  String get quotations => 'Quotations';

  @override
  String get quotation => 'Quotation';

  @override
  String get newQuotation => 'New quotation';

  @override
  String get editQuotation => 'Edit quotation';

  @override
  String get quotationNumber => 'Quotation number';

  @override
  String get quotationDate => 'Quotation date';

  @override
  String get validUntil => 'Valid until';

  @override
  String get sent => 'Sent';

  @override
  String get accepted => 'Accepted';

  @override
  String get rejected => 'Rejected';

  @override
  String get expired => 'Expired';

  @override
  String get converted => 'Converted';

  @override
  String get quotationTables => 'Tables';

  @override
  String get addTable => 'Add table';

  @override
  String get tableTitle => 'Table title';

  @override
  String get tableDiscount => 'Table discount';

  @override
  String get moveUp => 'Move up';

  @override
  String get moveDown => 'Move down';

  @override
  String get removeTable => 'Remove table';

  @override
  String get addQuotationLine => 'Add line';

  @override
  String get countryOfOrigin => 'Country of origin';

  @override
  String get origin => 'Origin';

  @override
  String get grossValue => 'Gross value';

  @override
  String get netValue => 'Net value';

  @override
  String get finalTotal => 'Final total';

  @override
  String get totalDiscounts => 'Total discounts';

  @override
  String get quotationDiscount => 'Quotation discount';

  @override
  String get subtotalBeforeDiscount => 'Subtotal before discount';

  @override
  String get quotationSummary => 'Summary';

  @override
  String get tableSubtotal => 'Table subtotal';

  @override
  String get termsAndConditions => 'Terms and conditions';

  @override
  String get notesLabel => 'Notes';

  @override
  String get managerName => 'Company manager';

  @override
  String get responsibleName => 'Responsible person';

  @override
  String get responsiblePhone => 'Responsible telephone';

  @override
  String get followUp => 'Follow up';

  @override
  String get followUpNote => 'What was discussed';

  @override
  String get followUpRequired =>
      'Write what was discussed before saving the follow-up.';

  @override
  String get statusHistory => 'History';

  @override
  String get sendQuotation => 'Issue and mark sent';

  @override
  String get acceptQuotation => 'Accept';

  @override
  String get rejectQuotation => 'Reject';

  @override
  String get reviseQuotation => 'Start a revision';

  @override
  String get convertToInvoice => 'Convert to invoice';

  @override
  String get convert => 'Convert';

  @override
  String get convertedInvoice => 'Converted invoice';

  @override
  String get conversionConfirm =>
      'Create a draft sales invoice from this accepted quotation? Nothing is posted and no stock moves until the invoice is posted separately.';

  @override
  String get conversionTaxNote =>
      'The quotation total is before tax. The invoice applies the company tax rules, so its total may be higher.';

  @override
  String get noQuotations => 'No quotations yet';

  @override
  String get printPreview => 'Print preview';

  @override
  String get downloadPdf => 'Download PDF';

  @override
  String get quotationSaved => 'Quotation saved';

  @override
  String get quotationSent => 'Quotation issued and marked as sent';

  @override
  String get quotationAccepted => 'Quotation accepted';

  @override
  String get quotationRejected => 'Quotation rejected';

  @override
  String get quotationRevised => 'A new draft revision was created';

  @override
  String get quotationConverted => 'Quotation converted to a draft invoice';

  @override
  String get quotationDeleted => 'Draft quotation removed';

  @override
  String get deleteQuotationConfirm =>
      'Remove this draft quotation? Issued quotations are never deleted.';

  @override
  String get quotationNeedsTable => 'Add at least one table with one line.';

  @override
  String get filterStatus => 'Status';

  @override
  String get fromDate => 'From date';

  @override
  String get toDate => 'To date';

  @override
  String get quotationDraftHint =>
      'This is a draft: nothing is posted and stock is untouched. Issuing it freezes the content that the customer receives.';

  @override
  String get optional => 'Optional';

  @override
  String get currency => 'Currency';

  @override
  String get clear => 'Clear';

  @override
  String get quotationFilterHint => 'Filter by status, customer or date';

  @override
  String get documentSettings => 'Documents and quotations';

  @override
  String get maximumDiscount => 'Maximum discount %';

  @override
  String get showTaxIdOnQuotations =>
      'Print the tax registration number on quotations';

  @override
  String get taxIdLegalNote =>
      'A display choice only. It never deletes the number, and it cannot override a legal requirement to show it.';

  @override
  String get salesManagerName => 'Sales manager';

  @override
  String get salesManagerPhone => 'Sales manager telephone';

  @override
  String get settingsSaved => 'Settings saved';

  @override
  String get saveSettings => 'Save settings';

  @override
  String get readOnlySettings =>
      'Changing these needs the company administration permission.';

  @override
  String get invalidSetting => 'Enter a value between 0 and 100.';

  @override
  String get networkAccessTitle => 'Network and remote access';

  @override
  String get networkUnavailable =>
      'The server did not answer its network report. Check that it is running.';

  @override
  String get lanReachable => 'Available on the local network';

  @override
  String get localOnly => 'This computer only';

  @override
  String get serverStatus => 'Server';

  @override
  String get serverReady => 'ready, database up';

  @override
  String get databaseDown => 'database not reachable';

  @override
  String get listeningOn => 'Listening on';

  @override
  String get localAddress => 'Local address';

  @override
  String get networkAddress => 'Network address';

  @override
  String get wouldBeAddress => 'Address if enabled';

  @override
  String get addressCopied => 'Address copied';

  @override
  String get copyAddress => 'Copy address';

  @override
  String get lanNotEnabledHint =>
      'The server is bound to this computer only, so the addresses below do not answer from another device. To allow the other computers on the network, set HOST=0.0.0.0 in the installation settings file and restart the program.';

  @override
  String get lanFirewallHint =>
      'Windows Firewall must also allow the program on private networks. The database port (5432) is never opened: other devices only reach the program, and still have to sign in.';

  @override
  String get publicAddressTitle => 'Public (internet) address';

  @override
  String get detectPublicAddress => 'Detect';

  @override
  String get publicAddressHint =>
      'Detected only when you press Detect. A public address alone does not make this server reachable from the internet: the router or the carrier may block incoming connections. For remote use, prefer a VPN or an HTTPS gateway; never expose the database.';

  @override
  String get publicAddressChecking => 'Checking…';

  @override
  String get publicAddressUnavailable =>
      'The public address could not be detected.';

  @override
  String get publicAddressNotProof =>
      'an address alone does not prove that incoming connections reach this computer.';

  @override
  String get lastChecked => 'Last checked';

  @override
  String get remove => 'Remove';

  @override
  String get termsLibrary => 'Saved terms';

  @override
  String get insertSavedTerms => 'Insert saved terms';

  @override
  String get saveTermsToLibrary => 'Save terms to library';

  @override
  String get termsTitle => 'Entry title';

  @override
  String get termsBody => 'Terms text';

  @override
  String get noSavedTerms =>
      'No saved terms yet. Write the terms below and save them for reuse.';

  @override
  String get termsSaved => 'Terms saved to the library';

  @override
  String get manageSavedTerms => 'Manage saved terms';

  @override
  String get termsInserted =>
      'Saved terms inserted. You can edit this copy freely.';

  @override
  String get removeSavedTerm =>
      'Remove this saved entry? Documents that already used it keep their own copy.';

  @override
  String get itemCode => 'Item code';

  @override
  String get subject => 'Subject';

  @override
  String get subjectHint =>
      'The headline of this offer, printed above the customer\'s name.';

  @override
  String get showTaxNumberOnOffer =>
      'Print the company tax number on this offer';

  @override
  String get showTaxNumberOnOfferHint =>
      'The company setting is only the default; this offer keeps its own choice.';

  @override
  String get quotationColumns => 'Line columns';

  @override
  String get columnLayout => 'Column layout';

  @override
  String get columnLayoutHint =>
      'Choose, rename, order and size the columns this offer prints.';

  @override
  String get columnLabelEn => 'English label';

  @override
  String get columnLabelAr => 'Arabic label';

  @override
  String get columnWidth => 'Width';

  @override
  String get columnNumeric => 'Numeric';

  @override
  String get tableColumns => 'This table\'s columns';

  @override
  String get builtinColumns => 'Built-in columns';

  @override
  String get columnType => 'Column type';

  @override
  String get columnTypeText => 'Text';

  @override
  String get columnTypeNumber => 'Number';

  @override
  String get columnTypeQuantity => 'Quantity';

  @override
  String get columnTypePrice => 'Price';

  @override
  String get columnTypePercent => 'Percent';

  @override
  String get columnNameRequired =>
      'Give the column a name in Arabic or English.';

  @override
  String get tablePreview => 'Table preview';

  @override
  String get addCustomColumn => 'Custom column…';

  @override
  String get columnKey => 'Column key';

  @override
  String get columnAlreadyExists => 'A column with this key already exists.';

  @override
  String get addColumn => 'Add column';

  @override
  String get removeColumn => 'Remove column';

  @override
  String get columnTemplate => 'Saved layout';

  @override
  String get templateName => 'New layout name';

  @override
  String get saveColumnTemplate => 'Save as a layout';

  @override
  String get templateSaved => 'Layout saved to the library';

  @override
  String get keepOneColumnVisible => 'Keep at least one column visible.';

  @override
  String get printedOnOffer => 'Printed';

  @override
  String get notPrintedOnOffer => 'Not printed';

  @override
  String get perWarehouse => 'Warehouses';

  @override
  String get unassignedWarehouse => 'Unassigned';

  @override
  String get fontSize => 'Font size';

  @override
  String get fontSizeDescription =>
      'Applies to the whole program: buttons, menus, the sidebar, tables, dialogs and reports. It is remembered for the next sign-in.';

  @override
  String get fontSizeSmaller => 'Smaller text';

  @override
  String get fontSizeLarger => 'Larger text';

  @override
  String get fontSizeReset => 'Default size';

  @override
  String get fontSizePreview =>
      'Preview: invoice 1,250.00 EGP · 12.5% discount';

  @override
  String get sessionNotPersisted =>
      'This session is kept in memory only: the browser will not store it on a plain http:// address. Reloading signs you out. Serve the program over HTTPS to keep the session.';

  @override
  String get signInIncomplete =>
      'The server accepted the sign-in but did not send the account details. This usually means the program and the server are different versions, or the company setup was not finished. The technical detail is in the program log.';

  @override
  String get sessionStorageLabel => 'Session storage';

  @override
  String get sessionStorageDurable => 'Saved on this device';

  @override
  String get sessionStorageMemoryOnly => 'Memory only';

  @override
  String get sessionStorageMemoryHint =>
      'This page is not served over HTTPS, so the browser keeps the session only until it is reloaded. Serve the program over HTTPS to keep people signed in.';

  @override
  String get errorDialogTitle => 'Something went wrong';

  @override
  String get warningDialogTitle => 'Notice';

  @override
  String get okAction => 'OK';

  @override
  String get errorGenericBody =>
      'The operation could not be completed because of an unexpected error. Nothing was saved. Try again, and if it keeps happening tell your system administrator.';

  @override
  String get errorInvalidInputBody =>
      'The submitted data is not valid, so nothing was changed. Check the fields and try again.';

  @override
  String get errorNotFoundBody =>
      'The record could not be found. It may have been deleted or moved, or you may not be allowed to see it. Reload the page and try again.';

  @override
  String get errorPermissionBody =>
      'You do not have permission to do this. Ask your system administrator if you need it.';

  @override
  String get errorConflictBody =>
      'Someone else changed this record while you were working on it, so your change was not saved. Reload the page to see the latest version, then try again.';

  @override
  String get errorServerBody =>
      'The server failed while carrying out the operation and nothing was saved. Try again shortly, and if it keeps happening tell your system administrator.';

  @override
  String get licence => 'Licence';

  @override
  String get licenceSubtitle => 'Licence status, activation and renewal';

  @override
  String get licenceSettingsSubtitle =>
      'Activation, renewal and user-account limit';

  @override
  String get licenceStateActive => 'Active';

  @override
  String get licenceStateExpired => 'Expired';

  @override
  String get licenceStateSuspended => 'Suspended';

  @override
  String get licenceStateUnlicensed => 'Not licensed';

  @override
  String get licenceMachineId => 'Machine ID';

  @override
  String get licenceLicenceId => 'Licence ID';

  @override
  String get licenceIssuedAt => 'Issued';

  @override
  String get licenceStartsAt => 'Started';

  @override
  String get licenceExpiresAt => 'Expires';

  @override
  String get licencePerpetual => 'Perpetual — no expiry';

  @override
  String get licenceDaysRemaining => 'Days remaining';

  @override
  String get licenceSeats => 'User accounts';

  @override
  String get licenceSeatsUsedLabel => 'Used';

  @override
  String get licenceSeatsLimitLabel => 'Limit';

  @override
  String get licenceSeatsAvailableLabel => 'Available';

  @override
  String get licenceSeatsExplainer =>
      'A seat is consumed when a login account is created and is never returned by deleting the account.';

  @override
  String get licenceRequestCode => 'Activation request code';

  @override
  String get licenceRequestCodeHint =>
      'Send this code to the supplier. It carries only this machine\'s ID and the program version.';

  @override
  String get licenceCopy => 'Copy';

  @override
  String get licenceCopied => 'Copied';

  @override
  String get licenceEnterKey => 'Licence key';

  @override
  String get licenceKeyHint =>
      'Paste the key the supplier sent, starting with KYN1.';

  @override
  String get licenceApply => 'Apply key';

  @override
  String get licenceOperation => 'What the key does';

  @override
  String get licenceOperationActivation => 'New activation';

  @override
  String get licenceOperationRenewal => 'Renewal';

  @override
  String get licenceOperationSeats => 'Add user accounts';

  @override
  String get licenceOperationTransfer => 'Move to this computer';

  @override
  String get licenceApplied => 'The licence was updated.';

  @override
  String get licenceClockTitle => 'System date check';

  @override
  String get licenceClockWarning =>
      'The system date is earlier than the last recorded run. Set the correct date and time in Windows, then confirm.';

  @override
  String get licenceConfirmClock => 'Confirm date and time';

  @override
  String get licenceEvents => 'Licence history';

  @override
  String get licenceEventsEmpty => 'No licence events yet.';

  @override
  String get licencePublicKey => 'Verification key';

  @override
  String get licenceNotConfigured =>
      'This installation has no verification key, so it cannot check any licence key. Reinstall with the supplier\'s public key.';

  @override
  String get licenceBlockedTitle => 'Work is stopped by the licence';

  @override
  String get licenceBlockedBody =>
      'Your data is intact. Nothing was deleted. Open the licence screen and apply a renewal key to continue working.';

  @override
  String get licenceKeyMissingTitle =>
      'The licence verification key is missing or invalid';

  @override
  String get licenceKeyMissingBody =>
      'This installation cannot check any licence key, so every business operation stays blocked. Your data is intact. The program stays open so you can see this state and reach the licence and backup screens; contact support to restore the approved verification key. Do not delete the licence state and do not reinstall.';

  @override
  String get licenceSuspendedBody =>
      'The program stopped because the system date is earlier than the last recorded run. Correct the date and time, then confirm on this screen. No data was lost.';

  @override
  String get licenceOpenLicence => 'Open the licence screen';

  @override
  String get licenceBackupStillAvailable =>
      'Backups and restores stay available while the licence is expired.';

  @override
  String get licenceOpenBackup => 'Backup and restore';

  @override
  String get licenceEnforcementEnforce => 'Enforced';

  @override
  String get licenceEnforcementWarn => 'Warning only';

  @override
  String get licenceEnforcementOff => 'Off';

  @override
  String get licenceSuperAdminOnly =>
      'Only a super administrator can change the licence.';

  @override
  String get licenceExpiringSoon =>
      'This licence expires soon. Renew it before it ends so no workday is interrupted.';

  @override
  String unitsBarcodesTitle(Object itemName) {
    return 'Units & barcodes — $itemName';
  }

  @override
  String get unitsBarcodesEmpty =>
      'No additional units or barcodes have been added.';

  @override
  String unitsBarcodesInactiveUnit(Object unitName) {
    return '$unitName (inactive)';
  }

  @override
  String unitsBarcodesFactorBarcode(Object barcode, Object factor) {
    return 'Factor: $factor  •  Barcode: $barcode';
  }

  @override
  String get unitsFieldAbbreviation => 'Short label';

  @override
  String get unitsFieldAbbreviationHelper => 'Printed where the full name is too long: م, كرت.';

  @override
  String unitsFieldAbbreviationValue(Object abbreviation) {
    return 'Short label: $abbreviation';
  }

  @override
  String get unitsFieldAllowFraction => 'Allow fractions';

  @override
  String get unitsFieldAllowFractionHelper =>
      'Off for a unit that cannot be split: half a carton does not exist.';

  @override
  String get unitsFieldPriceHelper =>
      'Per this unit. Leave empty to follow the item price × factor.';

  @override
  String get unitsFieldSortOrder => 'Display order';

  @override
  String get unitsFieldSortOrderHelper =>
      'Lower numbers appear first; the base unit always leads.';

  @override
  String get unitsFieldUsedInPurchases => 'Used when buying';

  @override
  String get unitsFieldUsedInSales => 'Used when selling';

  @override
  String unitsPerBasePrice(Object baseUnit, Object price) {
    return '$price per $baseUnit';
  }

  @override
  String get unitsPriceDisagrees => 'differs from the item price';

  @override
  String unitTakesWholeNumbers(Object unit) {
    return '$unit does not accept fractions; enter a whole number.';
  }

  @override
  String get unitsBarcodesHidden => 'hidden from new documents';

  @override
  String get unitsBarcodesBaseUnit => 'Base unit';

  @override
  String get unitsBarcodesGenerateTooltip => 'Generate / replace barcode';

  @override
  String get unitsBarcodesEditTooltip => 'Edit unit';

  @override
  String get unitsBarcodesReactivateTooltip => 'Reactivate unit';

  @override
  String get unitsBarcodesBaseCannotRemove => 'The base unit cannot be removed';

  @override
  String get unitsBarcodesRemoveTooltip => 'Remove unit';

  @override
  String get unitsBarcodesPrintLabels => 'Print labels';

  @override
  String get unitsBarcodesAdd => 'Add unit / barcode';

  @override
  String get unitsBarcodesFieldUnit => 'Unit name';

  @override
  String get unitsBarcodesFieldFactor => 'Base units per unit';

  @override
  String get unitsBarcodesFactorHelper =>
      'Example: 1 carton = 20 base units → factor 20.';

  @override
  String get unitsBarcodesFieldBarcode => 'Barcode';

  @override
  String get unitsBarcodesFieldSalePrice => 'Sale price';

  @override
  String get unitsBarcodesFieldPurchasePrice => 'Purchase price';

  @override
  String get unitsBarcodesAdded => 'Unit / barcode added.';

  @override
  String get unitsBarcodesBarcodeGenerated => 'Barcode generated.';

  @override
  String get unitsBarcodesReactivated => 'Unit reactivated.';

  @override
  String get unitsBarcodesRemoveTitle => 'Remove unit';

  @override
  String unitsBarcodesRemoveConfirm(Object unit) {
    return 'Remove $unit from this item? If it was used on a saved document, it will be deactivated instead of deleted, and hidden from new documents.';
  }

  @override
  String get unitsBarcodesDeactivated =>
      'Unit used on documents: deactivated, not deleted.';

  @override
  String get unitsBarcodesRemoved => 'Unit removed.';

  @override
  String get unitsBarcodesEditTitle => 'Edit unit';

  @override
  String get unitsBarcodesBaseCannotRenameHelper =>
      'The base unit cannot be renamed.';

  @override
  String get unitsBarcodesBaseFactorHelper =>
      'The base unit always converts 1:1.';

  @override
  String get unitsBarcodesFactorEditHelper =>
      'The saved factor is used when this unit is scanned or counted.';

  @override
  String get unitsBarcodesUpdated => 'Unit updated.';

  @override
  String get unitsBarcodesTooltip => 'Units & barcodes';

  @override
  String barcodeLabelsTitle(Object itemName) {
    return 'Print barcode labels — $itemName';
  }

  @override
  String barcodeLabelsInactiveUnit(Object unitName) {
    return '$unitName (inactive)';
  }

  @override
  String barcodeLabelsBarcode(Object barcode) {
    return 'Barcode: $barcode';
  }

  @override
  String get barcodeLabelsNoBarcode =>
      'No barcode assigned — assign one before printing';

  @override
  String get barcodeLabelsCopies => 'Copies';

  @override
  String get barcodeLabelsPaper => 'Paper';

  @override
  String get barcodeLabelsPaperA4 => 'A4 sheet (3 labels per row)';

  @override
  String get barcodeLabelsPaperThermal80 => 'Thermal roll 80 mm';

  @override
  String get barcodeLabelsPaperThermal58 => 'Thermal roll 58 mm';

  @override
  String get barcodeLabelsShowPrice => 'Show sale price';

  @override
  String get barcodeLabelsPdf => 'PDF';

  @override
  String get barcodeLabelsPrint => 'Print';

  @override
  String barcodeLabelsPrintCount(Object count) {
    return 'Print ($count)';
  }
}
