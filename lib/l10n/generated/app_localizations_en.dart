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
}
