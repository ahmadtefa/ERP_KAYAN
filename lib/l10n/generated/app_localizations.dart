import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'KAYAN ERP'**
  String get appTitle;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign In'**
  String get signIn;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign Out'**
  String get signOut;

  /// No description provided for @username.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get username;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @usernameRequired.
  ///
  /// In en, this message translates to:
  /// **'Username is required'**
  String get usernameRequired;

  /// No description provided for @passwordRequired.
  ///
  /// In en, this message translates to:
  /// **'Password is required'**
  String get passwordRequired;

  /// No description provided for @invalidCredentials.
  ///
  /// In en, this message translates to:
  /// **'Invalid username or password'**
  String get invalidCredentials;

  /// No description provided for @unexpectedError.
  ///
  /// In en, this message translates to:
  /// **'An unexpected error occurred'**
  String get unexpectedError;

  /// No description provided for @networkError.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server. Check your connection or the API address.'**
  String get networkError;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get loading;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @noData.
  ///
  /// In en, this message translates to:
  /// **'No data to display'**
  String get noData;

  /// No description provided for @welcomeBack.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get welcomeBack;

  /// No description provided for @dashboard.
  ///
  /// In en, this message translates to:
  /// **'Dashboard'**
  String get dashboard;

  /// No description provided for @chartOfAccounts.
  ///
  /// In en, this message translates to:
  /// **'Chart of Accounts'**
  String get chartOfAccounts;

  /// No description provided for @journalEntries.
  ///
  /// In en, this message translates to:
  /// **'Journal Entries'**
  String get journalEntries;

  /// No description provided for @sales.
  ///
  /// In en, this message translates to:
  /// **'Sales'**
  String get sales;

  /// No description provided for @purchases.
  ///
  /// In en, this message translates to:
  /// **'Purchases'**
  String get purchases;

  /// No description provided for @inventory.
  ///
  /// In en, this message translates to:
  /// **'Inventory'**
  String get inventory;

  /// No description provided for @reports.
  ///
  /// In en, this message translates to:
  /// **'Reports'**
  String get reports;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @arabic.
  ///
  /// In en, this message translates to:
  /// **'العربية'**
  String get arabic;

  /// No description provided for @english.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get english;

  /// No description provided for @systemDefault.
  ///
  /// In en, this message translates to:
  /// **'System default'**
  String get systemDefault;

  /// No description provided for @appearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get appearance;

  /// No description provided for @signedInAs.
  ///
  /// In en, this message translates to:
  /// **'Signed in as'**
  String get signedInAs;

  /// No description provided for @company.
  ///
  /// In en, this message translates to:
  /// **'Company'**
  String get company;

  /// No description provided for @branch.
  ///
  /// In en, this message translates to:
  /// **'Branch'**
  String get branch;

  /// No description provided for @notAvailable.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get notAvailable;

  /// No description provided for @version.
  ///
  /// In en, this message translates to:
  /// **'Version'**
  String get version;

  /// No description provided for @about.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get about;

  /// No description provided for @aboutDescription.
  ///
  /// In en, this message translates to:
  /// **'KAYAN ERP — cross-platform enterprise resource planning client.'**
  String get aboutDescription;

  /// No description provided for @quickAccess.
  ///
  /// In en, this message translates to:
  /// **'Quick access'**
  String get quickAccess;

  /// No description provided for @moduleComingSoon.
  ///
  /// In en, this message translates to:
  /// **'This module is not available yet.'**
  String get moduleComingSoon;

  /// No description provided for @accountsTotal.
  ///
  /// In en, this message translates to:
  /// **'Accounts'**
  String get accountsTotal;

  /// No description provided for @accountCode.
  ///
  /// In en, this message translates to:
  /// **'Code'**
  String get accountCode;

  /// No description provided for @accountName.
  ///
  /// In en, this message translates to:
  /// **'Account name'**
  String get accountName;

  /// No description provided for @accountType.
  ///
  /// In en, this message translates to:
  /// **'Type'**
  String get accountType;

  /// No description provided for @typeAsset.
  ///
  /// In en, this message translates to:
  /// **'Assets'**
  String get typeAsset;

  /// No description provided for @typeLiability.
  ///
  /// In en, this message translates to:
  /// **'Liabilities'**
  String get typeLiability;

  /// No description provided for @typeEquity.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get typeEquity;

  /// No description provided for @typeRevenue.
  ///
  /// In en, this message translates to:
  /// **'Revenue'**
  String get typeRevenue;

  /// No description provided for @typeExpense.
  ///
  /// In en, this message translates to:
  /// **'Expenses'**
  String get typeExpense;

  /// No description provided for @searchAccounts.
  ///
  /// In en, this message translates to:
  /// **'Search by code or name'**
  String get searchAccounts;

  /// No description provided for @noAccounts.
  ///
  /// In en, this message translates to:
  /// **'No accounts found'**
  String get noAccounts;

  /// No description provided for @postable.
  ///
  /// In en, this message translates to:
  /// **'Postable'**
  String get postable;

  /// No description provided for @grouping.
  ///
  /// In en, this message translates to:
  /// **'Group'**
  String get grouping;

  /// No description provided for @unbalancedEntry.
  ///
  /// In en, this message translates to:
  /// **'Journal entry is not balanced (debits must equal credits)'**
  String get unbalancedEntry;

  /// No description provided for @sampleDataNotice.
  ///
  /// In en, this message translates to:
  /// **'Development sample data — no backend is connected yet.'**
  String get sampleDataNotice;

  /// No description provided for @sampleDataDetail.
  ///
  /// In en, this message translates to:
  /// **'These records are generated locally for interface development. They are not stored and are not a system of record.'**
  String get sampleDataDetail;

  /// No description provided for @pendingDecisions.
  ///
  /// In en, this message translates to:
  /// **'Pending business decisions'**
  String get pendingDecisions;

  /// No description provided for @customers.
  ///
  /// In en, this message translates to:
  /// **'Customers'**
  String get customers;

  /// No description provided for @suppliers.
  ///
  /// In en, this message translates to:
  /// **'Suppliers'**
  String get suppliers;

  /// No description provided for @customer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get customer;

  /// No description provided for @supplier.
  ///
  /// In en, this message translates to:
  /// **'Supplier'**
  String get supplier;

  /// No description provided for @newCustomer.
  ///
  /// In en, this message translates to:
  /// **'New customer'**
  String get newCustomer;

  /// No description provided for @newSupplier.
  ///
  /// In en, this message translates to:
  /// **'New supplier'**
  String get newSupplier;

  /// No description provided for @editCustomer.
  ///
  /// In en, this message translates to:
  /// **'Edit customer'**
  String get editCustomer;

  /// No description provided for @editSupplier.
  ///
  /// In en, this message translates to:
  /// **'Edit supplier'**
  String get editSupplier;

  /// No description provided for @noCustomers.
  ///
  /// In en, this message translates to:
  /// **'No customers yet'**
  String get noCustomers;

  /// No description provided for @noSuppliers.
  ///
  /// In en, this message translates to:
  /// **'No suppliers yet'**
  String get noSuppliers;

  /// No description provided for @searchParties.
  ///
  /// In en, this message translates to:
  /// **'Search by code or name'**
  String get searchParties;

  /// No description provided for @phone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get phone;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @taxNumber.
  ///
  /// In en, this message translates to:
  /// **'Tax number'**
  String get taxNumber;

  /// No description provided for @address.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get address;

  /// No description provided for @creditLimit.
  ///
  /// In en, this message translates to:
  /// **'Credit limit'**
  String get creditLimit;

  /// No description provided for @creditLimitNote.
  ///
  /// In en, this message translates to:
  /// **'Recorded for reference. Enforcing it is a policy decision that has not been made yet.'**
  String get creditLimitNote;

  /// No description provided for @partyInactive.
  ///
  /// In en, this message translates to:
  /// **'Inactive — cannot be used on new invoices'**
  String get partyInactive;

  /// No description provided for @items.
  ///
  /// In en, this message translates to:
  /// **'Items'**
  String get items;

  /// No description provided for @item.
  ///
  /// In en, this message translates to:
  /// **'Item'**
  String get item;

  /// No description provided for @newItem.
  ///
  /// In en, this message translates to:
  /// **'New item'**
  String get newItem;

  /// No description provided for @editItem.
  ///
  /// In en, this message translates to:
  /// **'Edit item'**
  String get editItem;

  /// No description provided for @noItems.
  ///
  /// In en, this message translates to:
  /// **'No items yet'**
  String get noItems;

  /// No description provided for @searchItems.
  ///
  /// In en, this message translates to:
  /// **'Search by code or name'**
  String get searchItems;

  /// No description provided for @unit.
  ///
  /// In en, this message translates to:
  /// **'Unit'**
  String get unit;

  /// No description provided for @salePrice.
  ///
  /// In en, this message translates to:
  /// **'Sale price'**
  String get salePrice;

  /// No description provided for @costPrice.
  ///
  /// In en, this message translates to:
  /// **'Cost price'**
  String get costPrice;

  /// No description provided for @isStockTracked.
  ///
  /// In en, this message translates to:
  /// **'Stock tracked'**
  String get isStockTracked;

  /// No description provided for @stockTracked.
  ///
  /// In en, this message translates to:
  /// **'Stocked'**
  String get stockTracked;

  /// No description provided for @stockNotTracked.
  ///
  /// In en, this message translates to:
  /// **'Service / not stocked'**
  String get stockNotTracked;

  /// No description provided for @noStock.
  ///
  /// In en, this message translates to:
  /// **'No stock on hand'**
  String get noStock;

  /// No description provided for @stock.
  ///
  /// In en, this message translates to:
  /// **'Stock'**
  String get stock;

  /// No description provided for @stockBalances.
  ///
  /// In en, this message translates to:
  /// **'Stock balances'**
  String get stockBalances;

  /// No description provided for @onHand.
  ///
  /// In en, this message translates to:
  /// **'On hand'**
  String get onHand;

  /// No description provided for @averageCost.
  ///
  /// In en, this message translates to:
  /// **'Average cost'**
  String get averageCost;

  /// No description provided for @stockValue.
  ///
  /// In en, this message translates to:
  /// **'Value'**
  String get stockValue;

  /// No description provided for @itemLedger.
  ///
  /// In en, this message translates to:
  /// **'Item ledger'**
  String get itemLedger;

  /// No description provided for @movements.
  ///
  /// In en, this message translates to:
  /// **'Movements'**
  String get movements;

  /// No description provided for @direction.
  ///
  /// In en, this message translates to:
  /// **'Direction'**
  String get direction;

  /// No description provided for @movementIn.
  ///
  /// In en, this message translates to:
  /// **'Receipt'**
  String get movementIn;

  /// No description provided for @movementOut.
  ///
  /// In en, this message translates to:
  /// **'Issue'**
  String get movementOut;

  /// No description provided for @runningBalance.
  ///
  /// In en, this message translates to:
  /// **'Running balance'**
  String get runningBalance;

  /// No description provided for @reference.
  ///
  /// In en, this message translates to:
  /// **'Reference'**
  String get reference;

  /// No description provided for @noMovements.
  ///
  /// In en, this message translates to:
  /// **'No movements yet'**
  String get noMovements;

  /// No description provided for @totalQuantity.
  ///
  /// In en, this message translates to:
  /// **'Total quantity'**
  String get totalQuantity;

  /// No description provided for @totalValue.
  ///
  /// In en, this message translates to:
  /// **'Total value'**
  String get totalValue;

  /// No description provided for @salesInvoices.
  ///
  /// In en, this message translates to:
  /// **'Sales invoices'**
  String get salesInvoices;

  /// No description provided for @purchaseInvoices.
  ///
  /// In en, this message translates to:
  /// **'Purchase invoices'**
  String get purchaseInvoices;

  /// No description provided for @newSalesInvoice.
  ///
  /// In en, this message translates to:
  /// **'New sales invoice'**
  String get newSalesInvoice;

  /// No description provided for @newPurchaseInvoice.
  ///
  /// In en, this message translates to:
  /// **'New purchase invoice'**
  String get newPurchaseInvoice;

  /// No description provided for @invoiceNumber.
  ///
  /// In en, this message translates to:
  /// **'Number'**
  String get invoiceNumber;

  /// No description provided for @invoiceDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get invoiceDate;

  /// No description provided for @dueDate.
  ///
  /// In en, this message translates to:
  /// **'Due date'**
  String get dueDate;

  /// No description provided for @invoiceLines.
  ///
  /// In en, this message translates to:
  /// **'Lines'**
  String get invoiceLines;

  /// No description provided for @addLine.
  ///
  /// In en, this message translates to:
  /// **'Add line'**
  String get addLine;

  /// No description provided for @removeLine.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get removeLine;

  /// No description provided for @line.
  ///
  /// In en, this message translates to:
  /// **'Line'**
  String get line;

  /// No description provided for @description.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get description;

  /// No description provided for @lineDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get lineDescription;

  /// No description provided for @quantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get quantity;

  /// No description provided for @unitPrice.
  ///
  /// In en, this message translates to:
  /// **'Unit price'**
  String get unitPrice;

  /// No description provided for @taxRate.
  ///
  /// In en, this message translates to:
  /// **'Tax %'**
  String get taxRate;

  /// No description provided for @lineTotal.
  ///
  /// In en, this message translates to:
  /// **'Line total'**
  String get lineTotal;

  /// No description provided for @subTotal.
  ///
  /// In en, this message translates to:
  /// **'Subtotal'**
  String get subTotal;

  /// No description provided for @taxAmount.
  ///
  /// In en, this message translates to:
  /// **'Tax'**
  String get taxAmount;

  /// No description provided for @totalAmount.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get totalAmount;

  /// No description provided for @paidAmount.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get paidAmount;

  /// No description provided for @remaining.
  ///
  /// In en, this message translates to:
  /// **'Remaining'**
  String get remaining;

  /// No description provided for @costOfGoods.
  ///
  /// In en, this message translates to:
  /// **'Cost of goods'**
  String get costOfGoods;

  /// No description provided for @grossProfit.
  ///
  /// In en, this message translates to:
  /// **'Gross profit'**
  String get grossProfit;

  /// No description provided for @supplierReference.
  ///
  /// In en, this message translates to:
  /// **'Supplier reference'**
  String get supplierReference;

  /// No description provided for @noSalesInvoices.
  ///
  /// In en, this message translates to:
  /// **'No sales invoices yet'**
  String get noSalesInvoices;

  /// No description provided for @noPurchaseInvoices.
  ///
  /// In en, this message translates to:
  /// **'No purchase invoices yet'**
  String get noPurchaseInvoices;

  /// No description provided for @post.
  ///
  /// In en, this message translates to:
  /// **'Post'**
  String get post;

  /// No description provided for @reverse.
  ///
  /// In en, this message translates to:
  /// **'Reverse'**
  String get reverse;

  /// No description provided for @posted.
  ///
  /// In en, this message translates to:
  /// **'Posted'**
  String get posted;

  /// No description provided for @draft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get draft;

  /// No description provided for @reversed.
  ///
  /// In en, this message translates to:
  /// **'Reversed'**
  String get reversed;

  /// No description provided for @confirmPost.
  ///
  /// In en, this message translates to:
  /// **'Post this document? Stock and the ledger will be updated and it cannot be edited afterwards.'**
  String get confirmPost;

  /// No description provided for @confirmReverse.
  ///
  /// In en, this message translates to:
  /// **'Reverse this document? The original stays in the books and a mirror entry cancels it.'**
  String get confirmReverse;

  /// No description provided for @invoicePosted.
  ///
  /// In en, this message translates to:
  /// **'Invoice posted'**
  String get invoicePosted;

  /// No description provided for @invoiceReversed.
  ///
  /// In en, this message translates to:
  /// **'Invoice reversed'**
  String get invoiceReversed;

  /// No description provided for @invoiceSaved.
  ///
  /// In en, this message translates to:
  /// **'Draft saved'**
  String get invoiceSaved;

  /// No description provided for @posting.
  ///
  /// In en, this message translates to:
  /// **'Posting…'**
  String get posting;

  /// No description provided for @reversing.
  ///
  /// In en, this message translates to:
  /// **'Reversing…'**
  String get reversing;

  /// No description provided for @invoiceDetails.
  ///
  /// In en, this message translates to:
  /// **'Invoice details'**
  String get invoiceDetails;

  /// No description provided for @lines.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get lines;

  /// No description provided for @selectCustomer.
  ///
  /// In en, this message translates to:
  /// **'Select a customer'**
  String get selectCustomer;

  /// No description provided for @selectSupplier.
  ///
  /// In en, this message translates to:
  /// **'Select a supplier'**
  String get selectSupplier;

  /// No description provided for @selectItem.
  ///
  /// In en, this message translates to:
  /// **'Select an item'**
  String get selectItem;

  /// No description provided for @search.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get search;

  /// No description provided for @actions.
  ///
  /// In en, this message translates to:
  /// **'Actions'**
  String get actions;

  /// No description provided for @viewDetails.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get viewDetails;

  /// No description provided for @addLineFirst.
  ///
  /// In en, this message translates to:
  /// **'Add at least one line'**
  String get addLineFirst;

  /// No description provided for @partyRequired.
  ///
  /// In en, this message translates to:
  /// **'A customer is required'**
  String get partyRequired;

  /// No description provided for @supplierRequired.
  ///
  /// In en, this message translates to:
  /// **'A supplier is required'**
  String get supplierRequired;

  /// No description provided for @trialBalance.
  ///
  /// In en, this message translates to:
  /// **'Trial balance'**
  String get trialBalance;

  /// No description provided for @profitAndLoss.
  ///
  /// In en, this message translates to:
  /// **'Profit and loss'**
  String get profitAndLoss;

  /// No description provided for @customerBalances.
  ///
  /// In en, this message translates to:
  /// **'Customer balances'**
  String get customerBalances;

  /// No description provided for @supplierBalances.
  ///
  /// In en, this message translates to:
  /// **'Supplier balances'**
  String get supplierBalances;

  /// No description provided for @accountLedger.
  ///
  /// In en, this message translates to:
  /// **'Account ledger'**
  String get accountLedger;

  /// No description provided for @from.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get from;

  /// No description provided for @to.
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get to;

  /// No description provided for @asOf.
  ///
  /// In en, this message translates to:
  /// **'As at'**
  String get asOf;

  /// No description provided for @account.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get account;

  /// No description provided for @opening.
  ///
  /// In en, this message translates to:
  /// **'Opening'**
  String get opening;

  /// No description provided for @closing.
  ///
  /// In en, this message translates to:
  /// **'Closing'**
  String get closing;

  /// No description provided for @debit.
  ///
  /// In en, this message translates to:
  /// **'Debit'**
  String get debit;

  /// No description provided for @credit.
  ///
  /// In en, this message translates to:
  /// **'Credit'**
  String get credit;

  /// No description provided for @balance.
  ///
  /// In en, this message translates to:
  /// **'Balance'**
  String get balance;

  /// No description provided for @revenue.
  ///
  /// In en, this message translates to:
  /// **'Revenue'**
  String get revenue;

  /// No description provided for @expenses.
  ///
  /// In en, this message translates to:
  /// **'Expenses'**
  String get expenses;

  /// No description provided for @netProfit.
  ///
  /// In en, this message translates to:
  /// **'Net profit'**
  String get netProfit;

  /// No description provided for @totals.
  ///
  /// In en, this message translates to:
  /// **'Totals'**
  String get totals;

  /// No description provided for @difference.
  ///
  /// In en, this message translates to:
  /// **'Difference'**
  String get difference;

  /// No description provided for @balanced.
  ///
  /// In en, this message translates to:
  /// **'The ledger balances'**
  String get balanced;

  /// No description provided for @outOfBalance.
  ///
  /// In en, this message translates to:
  /// **'The ledger does not balance'**
  String get outOfBalance;

  /// No description provided for @runReport.
  ///
  /// In en, this message translates to:
  /// **'Run'**
  String get runReport;

  /// No description provided for @noBalances.
  ///
  /// In en, this message translates to:
  /// **'No balances in this range'**
  String get noBalances;

  /// No description provided for @accountRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose an account first'**
  String get accountRequired;

  /// No description provided for @period.
  ///
  /// In en, this message translates to:
  /// **'Period'**
  String get period;

  /// No description provided for @allBranches.
  ///
  /// In en, this message translates to:
  /// **'All branches'**
  String get allBranches;

  /// No description provided for @newJournalEntry.
  ///
  /// In en, this message translates to:
  /// **'New journal entry'**
  String get newJournalEntry;

  /// No description provided for @entryNumber.
  ///
  /// In en, this message translates to:
  /// **'Entry number'**
  String get entryNumber;

  /// No description provided for @noEntries.
  ///
  /// In en, this message translates to:
  /// **'No journal entries yet'**
  String get noEntries;

  /// No description provided for @postEntry.
  ///
  /// In en, this message translates to:
  /// **'Post'**
  String get postEntry;

  /// No description provided for @entryPosted.
  ///
  /// In en, this message translates to:
  /// **'Entry posted'**
  String get entryPosted;

  /// No description provided for @entryReversed.
  ///
  /// In en, this message translates to:
  /// **'Entry reversed'**
  String get entryReversed;

  /// No description provided for @entryUnbalanced.
  ///
  /// In en, this message translates to:
  /// **'Debits and credits must be equal'**
  String get entryUnbalanced;

  /// No description provided for @entryNeedsTwoLines.
  ///
  /// In en, this message translates to:
  /// **'An entry needs at least two lines'**
  String get entryNeedsTwoLines;

  /// No description provided for @journalDeleted.
  ///
  /// In en, this message translates to:
  /// **'A posted entry is corrected by reversing it, never by editing'**
  String get journalDeleted;

  /// No description provided for @add.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get add;

  /// No description provided for @edit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get edit;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @deactivate.
  ///
  /// In en, this message translates to:
  /// **'Deactivate'**
  String get deactivate;

  /// No description provided for @activate.
  ///
  /// In en, this message translates to:
  /// **'Reactivate'**
  String get activate;

  /// No description provided for @active.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get active;

  /// No description provided for @inactive.
  ///
  /// In en, this message translates to:
  /// **'Inactive'**
  String get inactive;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @searchHint.
  ///
  /// In en, this message translates to:
  /// **'Search…'**
  String get searchHint;

  /// No description provided for @createdSuccessfully.
  ///
  /// In en, this message translates to:
  /// **'Saved successfully'**
  String get createdSuccessfully;

  /// No description provided for @operationFailed.
  ///
  /// In en, this message translates to:
  /// **'The operation could not be completed'**
  String get operationFailed;

  /// No description provided for @requiredField.
  ///
  /// In en, this message translates to:
  /// **'This field is required'**
  String get requiredField;

  /// No description provided for @invalidNumber.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid number'**
  String get invalidNumber;

  /// No description provided for @mustBePositive.
  ///
  /// In en, this message translates to:
  /// **'Enter a number greater than zero'**
  String get mustBePositive;

  /// No description provided for @editInline.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get editInline;

  /// No description provided for @noPermission.
  ///
  /// In en, this message translates to:
  /// **'You do not have permission to do this'**
  String get noPermission;

  /// No description provided for @loading_data.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get loading_data;

  /// No description provided for @status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get status;

  /// No description provided for @users.
  ///
  /// In en, this message translates to:
  /// **'Users'**
  String get users;

  /// No description provided for @administration.
  ///
  /// In en, this message translates to:
  /// **'Administration'**
  String get administration;

  /// No description provided for @auditTrail.
  ///
  /// In en, this message translates to:
  /// **'Audit trail'**
  String get auditTrail;

  /// No description provided for @newUser.
  ///
  /// In en, this message translates to:
  /// **'New user'**
  String get newUser;

  /// No description provided for @editUser.
  ///
  /// In en, this message translates to:
  /// **'Edit user'**
  String get editUser;

  /// No description provided for @usernameHelper.
  ///
  /// In en, this message translates to:
  /// **'This is the name used to sign in. \"admin\" is reserved.'**
  String get usernameHelper;

  /// No description provided for @fullNameEn.
  ///
  /// In en, this message translates to:
  /// **'Name in English'**
  String get fullNameEn;

  /// No description provided for @fullNameAr.
  ///
  /// In en, this message translates to:
  /// **'Name in Arabic'**
  String get fullNameAr;

  /// No description provided for @passwordHelper.
  ///
  /// In en, this message translates to:
  /// **'At least 12 characters.'**
  String get passwordHelper;

  /// No description provided for @changePassword.
  ///
  /// In en, this message translates to:
  /// **'Change password'**
  String get changePassword;

  /// No description provided for @passwordChanged.
  ///
  /// In en, this message translates to:
  /// **'Password changed, and the old sessions were ended.'**
  String get passwordChanged;

  /// No description provided for @confirmDeactivateUser.
  ///
  /// In en, this message translates to:
  /// **'This user will no longer be able to sign in. Continue?'**
  String get confirmDeactivateUser;

  /// No description provided for @searchUsers.
  ///
  /// In en, this message translates to:
  /// **'Search users…'**
  String get searchUsers;

  /// No description provided for @noUsers.
  ///
  /// In en, this message translates to:
  /// **'No users'**
  String get noUsers;

  /// No description provided for @lastLogin.
  ///
  /// In en, this message translates to:
  /// **'Last sign-in'**
  String get lastLogin;

  /// No description provided for @never.
  ///
  /// In en, this message translates to:
  /// **'Never signed in'**
  String get never;

  /// No description provided for @superAdmin.
  ///
  /// In en, this message translates to:
  /// **'Super administrator'**
  String get superAdmin;

  /// No description provided for @roles.
  ///
  /// In en, this message translates to:
  /// **'Roles'**
  String get roles;

  /// No description provided for @newRole.
  ///
  /// In en, this message translates to:
  /// **'New role'**
  String get newRole;

  /// No description provided for @editRole.
  ///
  /// In en, this message translates to:
  /// **'Edit role'**
  String get editRole;

  /// No description provided for @roleCode.
  ///
  /// In en, this message translates to:
  /// **'Code'**
  String get roleCode;

  /// No description provided for @noRoles.
  ///
  /// In en, this message translates to:
  /// **'No roles'**
  String get noRoles;

  /// No description provided for @systemRole.
  ///
  /// In en, this message translates to:
  /// **'Built-in'**
  String get systemRole;

  /// No description provided for @customRole.
  ///
  /// In en, this message translates to:
  /// **'Custom'**
  String get customRole;

  /// No description provided for @deleteRole.
  ///
  /// In en, this message translates to:
  /// **'Delete role'**
  String get deleteRole;

  /// No description provided for @confirmDeleteRole.
  ///
  /// In en, this message translates to:
  /// **'This role will be removed. Continue?'**
  String get confirmDeleteRole;

  /// No description provided for @permissions.
  ///
  /// In en, this message translates to:
  /// **'Permissions'**
  String get permissions;

  /// No description provided for @setPermissions.
  ///
  /// In en, this message translates to:
  /// **'Edit permissions'**
  String get setPermissions;

  /// No description provided for @permissionsNote.
  ///
  /// In en, this message translates to:
  /// **'A built-in role: its permissions can be changed, but it cannot be renamed or removed.'**
  String get permissionsNote;

  /// No description provided for @action.
  ///
  /// In en, this message translates to:
  /// **'Action'**
  String get action;

  /// No description provided for @entity.
  ///
  /// In en, this message translates to:
  /// **'Entity'**
  String get entity;

  /// No description provided for @when.
  ///
  /// In en, this message translates to:
  /// **'When'**
  String get when;

  /// No description provided for @by.
  ///
  /// In en, this message translates to:
  /// **'By'**
  String get by;

  /// No description provided for @noAuditLogs.
  ///
  /// In en, this message translates to:
  /// **'Nothing has been recorded yet'**
  String get noAuditLogs;

  /// No description provided for @refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get refresh;

  /// No description provided for @fiscalPeriods.
  ///
  /// In en, this message translates to:
  /// **'Fiscal periods'**
  String get fiscalPeriods;

  /// No description provided for @newPeriod.
  ///
  /// In en, this message translates to:
  /// **'New period'**
  String get newPeriod;

  /// No description provided for @editPeriod.
  ///
  /// In en, this message translates to:
  /// **'Edit period'**
  String get editPeriod;

  /// No description provided for @periodCode.
  ///
  /// In en, this message translates to:
  /// **'Code'**
  String get periodCode;

  /// No description provided for @startDate.
  ///
  /// In en, this message translates to:
  /// **'Start date'**
  String get startDate;

  /// No description provided for @endDate.
  ///
  /// In en, this message translates to:
  /// **'End date'**
  String get endDate;

  /// No description provided for @open.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get open;

  /// No description provided for @closed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get closed;

  /// No description provided for @closedOn.
  ///
  /// In en, this message translates to:
  /// **'Closed on'**
  String get closedOn;

  /// No description provided for @closePeriod.
  ///
  /// In en, this message translates to:
  /// **'Close the period'**
  String get closePeriod;

  /// No description provided for @confirmClosePeriod.
  ///
  /// In en, this message translates to:
  /// **'After closing, nothing can be posted inside this period — not an invoice and not a manual entry. Continue?'**
  String get confirmClosePeriod;

  /// No description provided for @periodClosed.
  ///
  /// In en, this message translates to:
  /// **'The period was closed'**
  String get periodClosed;

  /// No description provided for @noPeriods.
  ///
  /// In en, this message translates to:
  /// **'No fiscal periods yet'**
  String get noPeriods;

  /// No description provided for @dataTools.
  ///
  /// In en, this message translates to:
  /// **'Data'**
  String get dataTools;

  /// No description provided for @importData.
  ///
  /// In en, this message translates to:
  /// **'Import from a file'**
  String get importData;

  /// No description provided for @backupTitle.
  ///
  /// In en, this message translates to:
  /// **'Backup and restore'**
  String get backupTitle;

  /// No description provided for @exportExcel.
  ///
  /// In en, this message translates to:
  /// **'Excel'**
  String get exportExcel;

  /// No description provided for @exportCsv.
  ///
  /// In en, this message translates to:
  /// **'CSV'**
  String get exportCsv;

  /// No description provided for @print.
  ///
  /// In en, this message translates to:
  /// **'Print'**
  String get print;

  /// No description provided for @chooseAccountFirst.
  ///
  /// In en, this message translates to:
  /// **'Choose an account first'**
  String get chooseAccountFirst;

  /// No description provided for @startOver.
  ///
  /// In en, this message translates to:
  /// **'Start over'**
  String get startOver;

  /// No description provided for @whatAreYouImporting.
  ///
  /// In en, this message translates to:
  /// **'What are you importing?'**
  String get whatAreYouImporting;

  /// No description provided for @templateFirst.
  ///
  /// In en, this message translates to:
  /// **'Start from the template'**
  String get templateFirst;

  /// No description provided for @templateExplains.
  ///
  /// In en, this message translates to:
  /// **'The template carries the right columns, an example row and a short explanation of each column.'**
  String get templateExplains;

  /// No description provided for @downloadTemplate.
  ///
  /// In en, this message translates to:
  /// **'Download the template'**
  String get downloadTemplate;

  /// No description provided for @importStep1.
  ///
  /// In en, this message translates to:
  /// **'Download the template'**
  String get importStep1;

  /// No description provided for @importStep2.
  ///
  /// In en, this message translates to:
  /// **'Fill it in and save it'**
  String get importStep2;

  /// No description provided for @importStep3.
  ///
  /// In en, this message translates to:
  /// **'Choose the file and read it'**
  String get importStep3;

  /// No description provided for @importStep4.
  ///
  /// In en, this message translates to:
  /// **'Import for real once it looks right'**
  String get importStep4;

  /// No description provided for @chooseFile.
  ///
  /// In en, this message translates to:
  /// **'Choose the file'**
  String get chooseFile;

  /// No description provided for @chooseAnotherFile.
  ///
  /// In en, this message translates to:
  /// **'Choose another file'**
  String get chooseAnotherFile;

  /// No description provided for @removeFile.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get removeFile;

  /// No description provided for @fileAcceptHint.
  ///
  /// In en, this message translates to:
  /// **'A .xlsx or .csv file, up to 10 MB.'**
  String get fileAcceptHint;

  /// No description provided for @readWithoutSaving.
  ///
  /// In en, this message translates to:
  /// **'Read it without saving'**
  String get readWithoutSaving;

  /// No description provided for @whatAboutExisting.
  ///
  /// In en, this message translates to:
  /// **'What should happen to records that already exist?'**
  String get whatAboutExisting;

  /// No description provided for @importModeSkip.
  ///
  /// In en, this message translates to:
  /// **'Leave them alone'**
  String get importModeSkip;

  /// No description provided for @importModeSkipHint.
  ///
  /// In en, this message translates to:
  /// **'A record whose code is already here is skipped and counted. Nothing is changed.'**
  String get importModeSkipHint;

  /// No description provided for @importModeUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update them'**
  String get importModeUpdate;

  /// No description provided for @importModeUpdateHint.
  ///
  /// In en, this message translates to:
  /// **'The columns the file carries are written over the record. A blank cell changes nothing.'**
  String get importModeUpdateHint;

  /// No description provided for @readResult.
  ///
  /// In en, this message translates to:
  /// **'What the file contains'**
  String get readResult;

  /// No description provided for @importResult.
  ///
  /// In en, this message translates to:
  /// **'What was imported'**
  String get importResult;

  /// No description provided for @rowsInFile.
  ///
  /// In en, this message translates to:
  /// **'Rows in the file'**
  String get rowsInFile;

  /// No description provided for @willBeAdded.
  ///
  /// In en, this message translates to:
  /// **'Will be added'**
  String get willBeAdded;

  /// No description provided for @willBeUpdated.
  ///
  /// In en, this message translates to:
  /// **'Will be updated'**
  String get willBeUpdated;

  /// No description provided for @willBeSkipped.
  ///
  /// In en, this message translates to:
  /// **'Already exist'**
  String get willBeSkipped;

  /// No description provided for @columnsNotUnderstood.
  ///
  /// In en, this message translates to:
  /// **'Columns not recognised'**
  String get columnsNotUnderstood;

  /// No description provided for @rowsWithProblems.
  ///
  /// In en, this message translates to:
  /// **'Rows with problems'**
  String get rowsWithProblems;

  /// No description provided for @row.
  ///
  /// In en, this message translates to:
  /// **'Row'**
  String get row;

  /// No description provided for @moreRows.
  ///
  /// In en, this message translates to:
  /// **'more rows'**
  String get moreRows;

  /// No description provided for @fixErrorsThenRetry.
  ///
  /// In en, this message translates to:
  /// **'Fix these rows in the file and upload it again. Nothing was written from them.'**
  String get fixErrorsThenRetry;

  /// No description provided for @importForReal.
  ///
  /// In en, this message translates to:
  /// **'Import for real'**
  String get importForReal;

  /// No description provided for @importDone.
  ///
  /// In en, this message translates to:
  /// **'Imported. The lists now hold these records.'**
  String get importDone;

  /// No description provided for @takeBackup.
  ///
  /// In en, this message translates to:
  /// **'Take a copy of the data'**
  String get takeBackup;

  /// No description provided for @takeBackupHint.
  ///
  /// In en, this message translates to:
  /// **'One file holding the whole company: accounts, parties, items, invoices, entries and the audit trail. Move it anywhere, restore it any time.'**
  String get takeBackupHint;

  /// No description provided for @recordsInTotal.
  ///
  /// In en, this message translates to:
  /// **'Records in total'**
  String get recordsInTotal;

  /// No description provided for @downloadBackup.
  ///
  /// In en, this message translates to:
  /// **'Download the backup'**
  String get downloadBackup;

  /// No description provided for @restoreBackup.
  ///
  /// In en, this message translates to:
  /// **'Restore from a copy'**
  String get restoreBackup;

  /// No description provided for @restoreWarning.
  ///
  /// In en, this message translates to:
  /// **'Restoring replaces everything this company holds with what is in the file. Anything recorded after the copy was taken is lost.'**
  String get restoreWarning;

  /// No description provided for @restoreChooseFile.
  ///
  /// In en, this message translates to:
  /// **'Choose a backup file (.json) that was downloaded from this screen.'**
  String get restoreChooseFile;

  /// No description provided for @chooseBackupFile.
  ///
  /// In en, this message translates to:
  /// **'Choose the backup file'**
  String get chooseBackupFile;

  /// No description provided for @inspectBackup.
  ///
  /// In en, this message translates to:
  /// **'Read the file first'**
  String get inspectBackup;

  /// No description provided for @inBackupFile.
  ///
  /// In en, this message translates to:
  /// **'In the file'**
  String get inBackupFile;

  /// No description provided for @inTheProgramNow.
  ///
  /// In en, this message translates to:
  /// **'In the program now'**
  String get inTheProgramNow;

  /// No description provided for @backupTakenAt.
  ///
  /// In en, this message translates to:
  /// **'Taken at'**
  String get backupTakenAt;

  /// No description provided for @backupOtherCompany.
  ///
  /// In en, this message translates to:
  /// **'This file belongs to another company. It cannot be restored here.'**
  String get backupOtherCompany;

  /// No description provided for @restoreNow.
  ///
  /// In en, this message translates to:
  /// **'Restore now'**
  String get restoreNow;

  /// No description provided for @confirmRestoreTitle.
  ///
  /// In en, this message translates to:
  /// **'Replace everything?'**
  String get confirmRestoreTitle;

  /// No description provided for @confirmRestoreBody.
  ///
  /// In en, this message translates to:
  /// **'The company\'s data will be replaced with the contents of this file. This cannot be undone. Continue?'**
  String get confirmRestoreBody;

  /// No description provided for @restoreDone.
  ///
  /// In en, this message translates to:
  /// **'Restored'**
  String get restoreDone;

  /// No description provided for @printPdfHint.
  ///
  /// In en, this message translates to:
  /// **'Opens a clean page for paper, ready for any printer.'**
  String get printPdfHint;

  /// No description provided for @exportPdf.
  ///
  /// In en, this message translates to:
  /// **'PDF'**
  String get exportPdf;

  /// No description provided for @printHintWhenNoPdf.
  ///
  /// In en, this message translates to:
  /// **'Opens a clean page for paper. In the print window, choose \"Save as PDF\" to keep it as a PDF file.'**
  String get printHintWhenNoPdf;

  /// No description provided for @downloadList.
  ///
  /// In en, this message translates to:
  /// **'Download the list'**
  String get downloadList;

  /// No description provided for @exportListHint.
  ///
  /// In en, this message translates to:
  /// **'Download this list as it stands: Excel, CSV, PDF, or a page to print.'**
  String get exportListHint;

  /// No description provided for @rememberLogin.
  ///
  /// In en, this message translates to:
  /// **'Remember sign-in details'**
  String get rememberLogin;

  /// No description provided for @rememberWebUsernameOnly.
  ///
  /// In en, this message translates to:
  /// **'Only the username is saved in this browser.'**
  String get rememberWebUsernameOnly;

  /// No description provided for @rememberNativeSecure.
  ///
  /// In en, this message translates to:
  /// **'Password is stored in device secure storage.'**
  String get rememberNativeSecure;

  /// No description provided for @newExpenseAccount.
  ///
  /// In en, this message translates to:
  /// **'New expense account'**
  String get newExpenseAccount;

  /// No description provided for @editExpenseAccount.
  ///
  /// In en, this message translates to:
  /// **'Edit expense account'**
  String get editExpenseAccount;

  /// No description provided for @parentAccount.
  ///
  /// In en, this message translates to:
  /// **'Parent account'**
  String get parentAccount;

  /// No description provided for @noParentAccount.
  ///
  /// In en, this message translates to:
  /// **'No parent'**
  String get noParentAccount;

  /// No description provided for @accountCanPost.
  ///
  /// In en, this message translates to:
  /// **'Can receive journal postings'**
  String get accountCanPost;

  /// No description provided for @activateAccount.
  ///
  /// In en, this message translates to:
  /// **'Activate account'**
  String get activateAccount;

  /// No description provided for @deactivateAccount.
  ///
  /// In en, this message translates to:
  /// **'Deactivate account'**
  String get deactivateAccount;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
