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

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired. Sign in again to continue.'**
  String get sessionExpired;

  /// No description provided for @permissionDenied.
  ///
  /// In en, this message translates to:
  /// **'You do not have permission to perform this action.'**
  String get permissionDenied;

  /// No description provided for @openingQuantity.
  ///
  /// In en, this message translates to:
  /// **'Opening quantity'**
  String get openingQuantity;

  /// No description provided for @openingUnitCost.
  ///
  /// In en, this message translates to:
  /// **'Opening unit cost'**
  String get openingUnitCost;

  /// No description provided for @openingStockHint.
  ///
  /// In en, this message translates to:
  /// **'Optional. Posts the stock and its inventory/equity entry with the item. Leave blank to enter opening stock later through Opening balances.'**
  String get openingStockHint;

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

  /// No description provided for @openingBalancesTitle.
  ///
  /// In en, this message translates to:
  /// **'Opening balances'**
  String get openingBalancesTitle;

  /// No description provided for @reviewOpeningBalances.
  ///
  /// In en, this message translates to:
  /// **'Review opening balances'**
  String get reviewOpeningBalances;

  /// No description provided for @noOpeningBalanceDocuments.
  ///
  /// In en, this message translates to:
  /// **'No opening-balance drafts yet'**
  String get noOpeningBalanceDocuments;

  /// No description provided for @openingBalanceDraftHint.
  ///
  /// In en, this message translates to:
  /// **'Imported opening balances are drafts until you review and post them.'**
  String get openingBalanceDraftHint;

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

  /// No description provided for @warehouse.
  ///
  /// In en, this message translates to:
  /// **'Warehouse'**
  String get warehouse;

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

  /// No description provided for @stockTrackingDoesNotAddQuantity.
  ///
  /// In en, this message translates to:
  /// **'Stock tracking does not add quantity. Use Opening balances to enter opening stock, then review and post the draft.'**
  String get stockTrackingDoesNotAddQuantity;

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

  /// No description provided for @landedCosts.
  ///
  /// In en, this message translates to:
  /// **'Landed costs'**
  String get landedCosts;

  /// No description provided for @landedCostAllocationHint.
  ///
  /// In en, this message translates to:
  /// **'Add each freight, shipping, duty, or other charge. The total is allocated across stock lines by line value.'**
  String get landedCostAllocationHint;

  /// No description provided for @landedCostCannotBeNegative.
  ///
  /// In en, this message translates to:
  /// **'Landed costs cannot be negative'**
  String get landedCostCannotBeNegative;

  /// No description provided for @addLandedCost.
  ///
  /// In en, this message translates to:
  /// **'Add charge'**
  String get addLandedCost;

  /// No description provided for @removeLandedCost.
  ///
  /// In en, this message translates to:
  /// **'Remove charge'**
  String get removeLandedCost;

  /// No description provided for @otherLandedCosts.
  ///
  /// In en, this message translates to:
  /// **'Other landed costs'**
  String get otherLandedCosts;

  /// No description provided for @landedCostDescriptionRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a description for each landed-cost charge'**
  String get landedCostDescriptionRequired;

  /// No description provided for @landedCostAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid non-negative amount for each landed-cost charge'**
  String get landedCostAmountInvalid;

  /// No description provided for @editDraftInvoice.
  ///
  /// In en, this message translates to:
  /// **'Edit draft invoice'**
  String get editDraftInvoice;

  /// No description provided for @onlyDraftInvoiceCanBeEdited.
  ///
  /// In en, this message translates to:
  /// **'Only a draft invoice can be edited'**
  String get onlyDraftInvoiceCanBeEdited;

  /// No description provided for @salesReturns.
  ///
  /// In en, this message translates to:
  /// **'Sales returns'**
  String get salesReturns;

  /// No description provided for @purchaseReturns.
  ///
  /// In en, this message translates to:
  /// **'Purchase returns'**
  String get purchaseReturns;

  /// No description provided for @newSalesReturn.
  ///
  /// In en, this message translates to:
  /// **'New sales return'**
  String get newSalesReturn;

  /// No description provided for @newPurchaseReturn.
  ///
  /// In en, this message translates to:
  /// **'New purchase return'**
  String get newPurchaseReturn;

  /// No description provided for @noReturns.
  ///
  /// In en, this message translates to:
  /// **'No returns yet'**
  String get noReturns;

  /// No description provided for @returnDate.
  ///
  /// In en, this message translates to:
  /// **'Return date'**
  String get returnDate;

  /// No description provided for @returnReason.
  ///
  /// In en, this message translates to:
  /// **'Return reason'**
  String get returnReason;

  /// No description provided for @originalInvoice.
  ///
  /// In en, this message translates to:
  /// **'Original invoice'**
  String get originalInvoice;

  /// No description provided for @selectOriginalInvoice.
  ///
  /// In en, this message translates to:
  /// **'Select a posted invoice'**
  String get selectOriginalInvoice;

  /// No description provided for @remainingToReturn.
  ///
  /// In en, this message translates to:
  /// **'Remaining to return'**
  String get remainingToReturn;

  /// No description provided for @quantityToReturn.
  ///
  /// In en, this message translates to:
  /// **'Quantity to return'**
  String get quantityToReturn;

  /// No description provided for @createReturn.
  ///
  /// In en, this message translates to:
  /// **'Create return'**
  String get createReturn;

  /// No description provided for @returnCreated.
  ///
  /// In en, this message translates to:
  /// **'Return saved as a draft'**
  String get returnCreated;

  /// No description provided for @confirmPostReturn.
  ///
  /// In en, this message translates to:
  /// **'Posting updates stock and the customer or supplier balance. Continue?'**
  String get confirmPostReturn;

  /// No description provided for @returnPosted.
  ///
  /// In en, this message translates to:
  /// **'Return posted'**
  String get returnPosted;

  /// No description provided for @returnReversed.
  ///
  /// In en, this message translates to:
  /// **'Return reversed'**
  String get returnReversed;

  /// No description provided for @returnLines.
  ///
  /// In en, this message translates to:
  /// **'Return lines'**
  String get returnLines;

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

  String get selectAll;

  String get clearAll;

  String get extraPermissions;

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

  /// No description provided for @newAccount.
  ///
  /// In en, this message translates to:
  /// **'New account'**
  String get newAccount;

  /// No description provided for @editAccount.
  ///
  /// In en, this message translates to:
  /// **'Edit account'**
  String get editAccount;

  /// No description provided for @deleteAccount.
  ///
  /// In en, this message translates to:
  /// **'Delete account'**
  String get deleteAccount;

  /// No description provided for @deleteAccountConfirm.
  ///
  /// In en, this message translates to:
  /// **'The account “{account}” will be deleted, as long as it has no movements or sub-accounts. Continue?'**
  String deleteAccountConfirm(Object account);

  /// No description provided for @allTypes.
  ///
  /// In en, this message translates to:
  /// **'All types'**
  String get allTypes;

  /// No description provided for @inactiveLabel.
  ///
  /// In en, this message translates to:
  /// **'Inactive'**
  String get inactiveLabel;

  /// No description provided for @accountCodeHelper.
  ///
  /// In en, this message translates to:
  /// **'Leave empty to suggest the next code using the chart’s own numbering'**
  String get accountCodeHelper;

  /// No description provided for @nameArabic.
  ///
  /// In en, this message translates to:
  /// **'Name in Arabic'**
  String get nameArabic;

  /// No description provided for @nameEnglish.
  ///
  /// In en, this message translates to:
  /// **'Name in English'**
  String get nameEnglish;

  /// No description provided for @parentAccount.
  ///
  /// In en, this message translates to:
  /// **'Parent account'**
  String get parentAccount;

  /// No description provided for @parentAccountHelper.
  ///
  /// In en, this message translates to:
  /// **'A sub-account takes its parent’s type'**
  String get parentAccountHelper;

  /// No description provided for @noParent.
  ///
  /// In en, this message translates to:
  /// **'No parent (top-level)'**
  String get noParent;

  /// No description provided for @postableHelper.
  ///
  /// In en, this message translates to:
  /// **'A grouping account cannot receive postings; a final account can'**
  String get postableHelper;

  /// No description provided for @activeAccount.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get activeAccount;

  /// No description provided for @rememberMe.
  ///
  /// In en, this message translates to:
  /// **'Remember me'**
  String get rememberMe;

  /// No description provided for @rememberMeHint.
  ///
  /// In en, this message translates to:
  /// **'On the web only the username is kept'**
  String get rememberMeHint;

  /// No description provided for @clearSavedCredentials.
  ///
  /// In en, this message translates to:
  /// **'Clear saved sign-in'**
  String get clearSavedCredentials;

  /// No description provided for @savedCredentialsCleared.
  ///
  /// In en, this message translates to:
  /// **'Saved sign-in details cleared'**
  String get savedCredentialsCleared;

  /// No description provided for @companySettings.
  ///
  /// In en, this message translates to:
  /// **'Company settings'**
  String get companySettings;

  /// No description provided for @companyProfile.
  ///
  /// In en, this message translates to:
  /// **'Company profile'**
  String get companyProfile;

  /// No description provided for @companyCode.
  ///
  /// In en, this message translates to:
  /// **'Company code'**
  String get companyCode;

  /// No description provided for @taxId.
  ///
  /// In en, this message translates to:
  /// **'Tax ID'**
  String get taxId;

  /// No description provided for @companyLogo.
  ///
  /// In en, this message translates to:
  /// **'Company logo'**
  String get companyLogo;

  /// No description provided for @uploadLogo.
  ///
  /// In en, this message translates to:
  /// **'Upload logo'**
  String get uploadLogo;

  /// No description provided for @removeLogo.
  ///
  /// In en, this message translates to:
  /// **'Remove logo'**
  String get removeLogo;

  /// No description provided for @logoHint.
  ///
  /// In en, this message translates to:
  /// **'Optional — PNG, JPEG or WebP; resized to 1024 × 1024 px, up to 2 MB.'**
  String get logoHint;

  /// No description provided for @logoUpdated.
  ///
  /// In en, this message translates to:
  /// **'Logo updated'**
  String get logoUpdated;

  /// No description provided for @logoRemoved.
  ///
  /// In en, this message translates to:
  /// **'Logo removed'**
  String get logoRemoved;

  /// No description provided for @logoInvalid.
  String get logoInvalid;

  /// No description provided for @logoTooLarge.
  String get logoTooLarge;

  /// No description provided for @demoBackupTitle.
  String get demoBackupTitle;

  /// No description provided for @demoBackupHint.
  String get demoBackupHint;

  /// No description provided for @downloadDemoBackup.
  String get downloadDemoBackup;

  /// No description provided for @demoLoginHint.
  String get demoLoginHint;

  /// No description provided for @noLogo.
  ///
  /// In en, this message translates to:
  /// **'No logo'**
  String get noLogo;

  /// No description provided for @branches.
  ///
  /// In en, this message translates to:
  /// **'Branches and units'**
  String get branches;

  /// No description provided for @newBranch.
  ///
  /// In en, this message translates to:
  /// **'New unit'**
  String get newBranch;

  /// No description provided for @editBranch.
  ///
  /// In en, this message translates to:
  /// **'Edit unit'**
  String get editBranch;

  /// No description provided for @branchCode.
  ///
  /// In en, this message translates to:
  /// **'Unit code'**
  String get branchCode;

  /// No description provided for @branchKind.
  ///
  /// In en, this message translates to:
  /// **'Unit type'**
  String get branchKind;

  /// No description provided for @headquarters.
  ///
  /// In en, this message translates to:
  /// **'Headquarters'**
  String get headquarters;

  /// No description provided for @branchUnit.
  ///
  /// In en, this message translates to:
  /// **'Branch'**
  String get branchUnit;

  /// No description provided for @parentUnit.
  ///
  /// In en, this message translates to:
  /// **'Parent unit'**
  String get parentUnit;

  /// No description provided for @parentUnitRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose the headquarters or parent unit'**
  String get parentUnitRequired;

  /// No description provided for @deleteBranch.
  ///
  /// In en, this message translates to:
  /// **'Delete unit'**
  String get deleteBranch;

  /// No description provided for @deleteBranchConfirm.
  ///
  /// In en, this message translates to:
  /// **'The unit “{unit}” will be deleted. Units with movements cannot be deleted.'**
  String deleteBranchConfirm(Object unit);

  /// No description provided for @branchSaved.
  ///
  /// In en, this message translates to:
  /// **'Unit saved'**
  String get branchSaved;

  /// No description provided for @profileSaved.
  ///
  /// In en, this message translates to:
  /// **'Company details saved'**
  String get profileSaved;

  /// No description provided for @unitType.
  ///
  /// In en, this message translates to:
  /// **'Kind'**
  String get unitType;

  /// No description provided for @fullBackupTitle.
  ///
  /// In en, this message translates to:
  /// **'Full database backup'**
  String get fullBackupTitle;

  /// No description provided for @fullBackupDescription.
  ///
  /// In en, this message translates to:
  /// **'A complete copy of the whole database (every company and user) in PostgreSQL format. It is made on the server that hosts the database.'**
  String get fullBackupDescription;

  /// No description provided for @createFullBackup.
  ///
  /// In en, this message translates to:
  /// **'Create full backup'**
  String get createFullBackup;

  /// No description provided for @backupInProgress.
  ///
  /// In en, this message translates to:
  /// **'Creating the backup…'**
  String get backupInProgress;

  /// No description provided for @backupFiles.
  ///
  /// In en, this message translates to:
  /// **'Backups on the server'**
  String get backupFiles;

  /// No description provided for @deleteBackup.
  ///
  /// In en, this message translates to:
  /// **'Delete backup'**
  String get deleteBackup;

  /// No description provided for @deleteBackupConfirm.
  ///
  /// In en, this message translates to:
  /// **'The file “{file}” will be permanently removed from the server.'**
  String deleteBackupConfirm(Object file);

  /// No description provided for @restoreFullDatabase.
  ///
  /// In en, this message translates to:
  /// **'Restore the whole database'**
  String get restoreFullDatabase;

  /// No description provided for @restoreFullWarning.
  ///
  /// In en, this message translates to:
  /// **'A full restore replaces everything currently in the database. A safety backup is taken automatically first.'**
  String get restoreFullWarning;

  /// No description provided for @uploadDumpFile.
  ///
  /// In en, this message translates to:
  /// **'Upload a backup file (.dump)'**
  String get uploadDumpFile;

  /// No description provided for @orChooseServerBackup.
  ///
  /// In en, this message translates to:
  /// **'Or choose a backup on the server'**
  String get orChooseServerBackup;

  /// No description provided for @confirmFullRestoreTitle.
  ///
  /// In en, this message translates to:
  /// **'Full restore — explicit confirmation'**
  String get confirmFullRestoreTitle;

  /// No description provided for @confirmFullRestoreBody.
  ///
  /// In en, this message translates to:
  /// **'Type RESTORE to confirm. Everything currently in the database will be replaced by the contents of the backup.'**
  String get confirmFullRestoreBody;

  /// No description provided for @restoreFullDone.
  ///
  /// In en, this message translates to:
  /// **'Restore completed'**
  String get restoreFullDone;

  /// No description provided for @restoreFullFailed.
  ///
  /// In en, this message translates to:
  /// **'Restore failed'**
  String get restoreFullFailed;

  /// No description provided for @fullBackupUnavailable.
  ///
  /// In en, this message translates to:
  /// **'PostgreSQL tools (pg_dump / pg_restore) were not found on this server'**
  String get fullBackupUnavailable;

  /// No description provided for @maintenanceActive.
  ///
  /// In en, this message translates to:
  /// **'The system is under maintenance — a restore is in progress'**
  String get maintenanceActive;

  /// No description provided for @safetyBackup.
  ///
  /// In en, this message translates to:
  /// **'Safety backup'**
  String get safetyBackup;

  /// No description provided for @fullBackupKind.
  ///
  /// In en, this message translates to:
  /// **'Full backup'**
  String get fullBackupKind;

  /// No description provided for @createdAtLabel.
  ///
  /// In en, this message translates to:
  /// **'Created'**
  String get createdAtLabel;

  /// No description provided for @sizeLabel.
  ///
  /// In en, this message translates to:
  /// **'Size'**
  String get sizeLabel;

  /// No description provided for @refreshStatus.
  ///
  /// In en, this message translates to:
  /// **'Refresh status'**
  String get refreshStatus;

  /// No description provided for @companySettingsHint.
  ///
  /// In en, this message translates to:
  /// **'Name, logo, contact details and branches'**
  String get companySettingsHint;
  String get rememberLogin;

  String get rememberWebUsernameOnly;

  String get rememberNativeSecure;

  String get newExpenseAccount;

  String get editExpenseAccount;

  String get noParentAccount;

  String get accountCanPost;

  String get activateAccount;

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

  /// No description provided for @downloadStarted.
  ///
  /// In en, this message translates to:
  /// **'The file is downloading.'**
  String get downloadStarted;

  /// No description provided for @downloadFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'The file could not be downloaded.'**
  String get downloadFailedTitle;

  /// No description provided for @printOpened.
  ///
  /// In en, this message translates to:
  /// **'The print page is opening in a new tab.'**
  String get printOpened;

  /// No description provided for @printBlocked.
  ///
  /// In en, this message translates to:
  /// **'The browser blocked the new tab. Allow pop-ups for this address, then press Print again.'**
  String get printBlocked;

  /// No description provided for @resetData.
  ///
  /// In en, this message translates to:
  /// **'Reset the program\'s data'**
  String get resetData;

  /// No description provided for @resetDataHint.
  ///
  /// In en, this message translates to:
  /// **'Clears this company’s books and returns the program to its first run. A backup is taken and checked before anything is deleted, and the reset stops if that backup fails.'**
  String get resetDataHint;

  /// No description provided for @resetButton.
  ///
  /// In en, this message translates to:
  /// **'Reset ERP Data'**
  String get resetButton;

  /// No description provided for @resetOnlyAdmins.
  ///
  /// In en, this message translates to:
  /// **'Only an administrator of the program can do this.'**
  String get resetOnlyAdmins;

  /// No description provided for @resetForCompany.
  ///
  /// In en, this message translates to:
  /// **'This will reset “{company}”.'**
  String resetForCompany(Object company);

  /// No description provided for @resetWhatIsDeleted.
  ///
  /// In en, this message translates to:
  /// **'What will be deleted'**
  String get resetWhatIsDeleted;

  /// No description provided for @resetWhatIsKept.
  ///
  /// In en, this message translates to:
  /// **'What is kept'**
  String get resetWhatIsKept;

  /// No description provided for @resetDeletedHint.
  ///
  /// In en, this message translates to:
  /// **'Every record the company holds: its books, its parties, its stock and its documents.'**
  String get resetDeletedHint;

  /// No description provided for @resetKeptAdmin.
  ///
  /// In en, this message translates to:
  /// **'The administrator account you are signed in with'**
  String get resetKeptAdmin;

  /// No description provided for @resetKeptPermissions.
  ///
  /// In en, this message translates to:
  /// **'The permission catalogue'**
  String get resetKeptPermissions;

  /// No description provided for @resetKeptRoles.
  ///
  /// In en, this message translates to:
  /// **'The roles the program ships with'**
  String get resetKeptRoles;

  /// No description provided for @resetKeptConfig.
  ///
  /// In en, this message translates to:
  /// **'The database connection and the program’s settings'**
  String get resetKeptConfig;

  /// No description provided for @resetCountJournalEntries.
  ///
  /// In en, this message translates to:
  /// **'Journal entries'**
  String get resetCountJournalEntries;

  /// No description provided for @resetCountAccounts.
  ///
  /// In en, this message translates to:
  /// **'Accounts'**
  String get resetCountAccounts;

  /// No description provided for @resetCountCustomers.
  ///
  /// In en, this message translates to:
  /// **'Customers'**
  String get resetCountCustomers;

  /// No description provided for @resetCountSuppliers.
  ///
  /// In en, this message translates to:
  /// **'Suppliers'**
  String get resetCountSuppliers;

  /// No description provided for @resetCountItems.
  ///
  /// In en, this message translates to:
  /// **'Items'**
  String get resetCountItems;

  /// No description provided for @resetCountSalesInvoices.
  ///
  /// In en, this message translates to:
  /// **'Sales invoices'**
  String get resetCountSalesInvoices;

  /// No description provided for @resetCountPurchaseInvoices.
  ///
  /// In en, this message translates to:
  /// **'Purchase invoices'**
  String get resetCountPurchaseInvoices;

  /// No description provided for @resetCountStockMovements.
  ///
  /// In en, this message translates to:
  /// **'Stock movements'**
  String get resetCountStockMovements;

  /// No description provided for @resetCountFiscalPeriods.
  ///
  /// In en, this message translates to:
  /// **'Financial periods'**
  String get resetCountFiscalPeriods;

  /// No description provided for @resetCountBranches.
  ///
  /// In en, this message translates to:
  /// **'Branches'**
  String get resetCountBranches;

  /// No description provided for @resetCountUsers.
  ///
  /// In en, this message translates to:
  /// **'Other users'**
  String get resetCountUsers;

  /// No description provided for @resetBackupFirst.
  ///
  /// In en, this message translates to:
  /// **'A full backup will be taken and checked before anything is deleted. If the backup cannot be taken, or cannot be read back, nothing is deleted at all.'**
  String get resetBackupFirst;

  /// No description provided for @resetConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'This cannot be undone'**
  String get resetConfirmTitle;

  /// No description provided for @resetConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'The only way back is to restore the backup that is about to be taken. Type your password and the word {word} to go ahead.'**
  String resetConfirmBody(Object word);

  /// No description provided for @resetPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Your password'**
  String get resetPasswordLabel;

  /// No description provided for @resetPasswordHint.
  ///
  /// In en, this message translates to:
  /// **'The password of the account you are signed in with. The server checks it.'**
  String get resetPasswordHint;

  /// No description provided for @resetWordLabel.
  ///
  /// In en, this message translates to:
  /// **'Type {word}'**
  String resetWordLabel(Object word);

  /// No description provided for @resetWrongWord.
  ///
  /// In en, this message translates to:
  /// **'Type {word} exactly as it is written to confirm.'**
  String resetWrongWord(Object word);

  /// No description provided for @resetDone.
  ///
  /// In en, this message translates to:
  /// **'The company’s data was cleared. “{file}” holds the old data.'**
  String resetDone(Object file);

  /// No description provided for @resetNeedsSetup.
  ///
  /// In en, this message translates to:
  /// **'The program will ask to be set up again the next time it is opened.'**
  String get resetNeedsSetup;

  /// No description provided for @resetPreviewFailed.
  ///
  /// In en, this message translates to:
  /// **'What a reset would remove could not be read.'**
  String get resetPreviewFailed;

  /// No description provided for @cashAndBanks.
  ///
  /// In ar, this message translates to:
  /// **'الخزائن والبنوك'**
  String get cashAndBanks;

  /// No description provided for @newCashAccount.
  ///
  /// In ar, this message translates to:
  /// **'خزنة أو حساب بنكي جديد'**
  String get newCashAccount;

  /// No description provided for @cashAccount.
  ///
  /// In ar, this message translates to:
  /// **'الخزنة أو البنك'**
  String get cashAccount;

  /// No description provided for @cashBox.
  ///
  /// In ar, this message translates to:
  /// **'خزنة'**
  String get cashBox;

  /// No description provided for @bank.
  ///
  /// In ar, this message translates to:
  /// **'بنك'**
  String get bank;

  /// No description provided for @bankName.
  ///
  /// In ar, this message translates to:
  /// **'اسم البنك'**
  String get bankName;

  /// No description provided for @iban.
  ///
  /// In ar, this message translates to:
  /// **'رقم الحساب الدولي'**
  String get iban;

  /// No description provided for @ledgerAccount.
  ///
  /// In ar, this message translates to:
  /// **'الحساب الدفتري'**
  String get ledgerAccount;

  /// No description provided for @noCashAccounts.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد خزائن أو بنوك بعد'**
  String get noCashAccounts;

  /// No description provided for @statement.
  ///
  /// In ar, this message translates to:
  /// **'كشف حساب'**
  String get statement;

  /// No description provided for @vouchers.
  ///
  /// In ar, this message translates to:
  /// **'سندات القبض والصرف'**
  String get vouchers;

  /// No description provided for @newVoucher.
  ///
  /// In ar, this message translates to:
  /// **'سند قبض أو صرف جديد'**
  String get newVoucher;

  /// No description provided for @receipt.
  ///
  /// In ar, this message translates to:
  /// **'سند قبض'**
  String get receipt;

  /// No description provided for @payment.
  ///
  /// In ar, this message translates to:
  /// **'سند صرف'**
  String get payment;

  /// No description provided for @voucherType.
  ///
  /// In ar, this message translates to:
  /// **'النوع'**
  String get voucherType;

  /// No description provided for @voucherNumber.
  ///
  /// In ar, this message translates to:
  /// **'الرقم'**
  String get voucherNumber;

  /// No description provided for @amount.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ'**
  String get amount;

  /// No description provided for @noVouchers.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد سندات بعد'**
  String get noVouchers;

  /// No description provided for @transfers.
  ///
  /// In ar, this message translates to:
  /// **'التحويلات'**
  String get transfers;

  /// No description provided for @newTransfer.
  ///
  /// In ar, this message translates to:
  /// **'تحويل جديد'**
  String get newTransfer;

  /// No description provided for @fromAccount.
  ///
  /// In ar, this message translates to:
  /// **'من'**
  String get fromAccount;

  /// No description provided for @toAccount.
  ///
  /// In ar, this message translates to:
  /// **'إلى'**
  String get toAccount;

  /// No description provided for @noTransfers.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد تحويلات بعد'**
  String get noTransfers;

  /// No description provided for @transferNeedsTwoAccounts.
  ///
  /// In ar, this message translates to:
  /// **'يحتاج التحويل إلى خزنتين أو حسابين بنكيين'**
  String get transferNeedsTwoAccounts;

  /// No description provided for @party.
  ///
  /// In ar, this message translates to:
  /// **'الطرف'**
  String get party;

  /// No description provided for @saved.
  ///
  /// In ar, this message translates to:
  /// **'تم الحفظ'**
  String get saved;

  /// No description provided for @settleOldestFirst.
  ///
  /// In ar, this message translates to:
  /// **'تم تخصيص المبلغ على أقدم الفواتير المفتوحة'**
  String get settleOldestFirst;

  /// In en, this message translates to:
  /// **'Cost centers'**
  String get costCenters;

  /// In en, this message translates to:
  /// **'Cost center'**
  String get costCenter;

  /// In en, this message translates to:
  /// **'New cost center'**
  String get newCostCenter;

  /// In en, this message translates to:
  /// **'Edit cost center'**
  String get editCostCenter;

  /// In en, this message translates to:
  /// **'Cost center code'**
  String get costCenterCode;

  /// In en, this message translates to:
  /// **'Cost center type'**
  String get costCenterType;

  /// In en, this message translates to:
  /// **'Department'**
  String get department;

  /// In en, this message translates to:
  /// **'Administrative unit'**
  String get administrativeUnit;

  /// In en, this message translates to:
  /// **'Project'**
  String get project;

  /// In en, this message translates to:
  /// **'Responsible person'**
  String get responsiblePerson;

  /// In en, this message translates to:
  /// **'Parent cost center'**
  String get parentCostCenter;

  /// In en, this message translates to:
  /// **'Search cost centers'**
  String get searchCostCenters;

  /// In en, this message translates to:
  /// **'No cost centers yet'**
  String get noCostCenters;

  /// In en, this message translates to:
  /// **'Cost center saved'**
  String get costCenterSaved;

  /// In en, this message translates to:
  /// **'Cost center deactivated'**
  String get costCenterDeactivated;

  /// In en, this message translates to:
  /// **'Deactivating stops new postings. Existing transactions keep their centre. Continue?'**
  String get confirmDeactivateCostCenter;

  /// In en, this message translates to:
  /// **'Delete cost center'**
  String get deleteCostCenter;

  /// In en, this message translates to:
  /// **'Only an unused cost center can be deleted. If it has transactions, deactivate it instead. Continue?'**
  String get confirmDeleteCostCenter;

  /// In en, this message translates to:
  /// **'Cost center deleted'**
  String get costCenterDeleted;

  /// In en, this message translates to:
  /// **'All parents'**
  String get allParents;

  /// In en, this message translates to:
  /// **'All statuses'**
  String get allStatuses;

  /// In en, this message translates to:
  /// **'Usage'**
  String get usage;

  /// In en, this message translates to:
  /// **'Journal lines'**
  String get journalLinesUsing;

  /// In en, this message translates to:
  /// **'Allocated lines'**
  String get allocatedLinesUsing;

  /// In en, this message translates to:
  /// **'Cost centers'**
  String get costCenterReport;

  /// In en, this message translates to:
  /// **'Own'**
  String get ownAmount;

  /// In en, this message translates to:
  /// **'Including children'**
  String get rolledUp;

  /// In en, this message translates to:
  /// **'Unallocated'**
  String get unallocated;

  /// In en, this message translates to:
  /// **'Transactions'**
  String get transactions;

  /// In en, this message translates to:
  /// **'No transactions in this period'**
  String get noTransactions;

  /// In en, this message translates to:
  /// **'Details'**
  String get drillDown;

  /// In en, this message translates to:
  /// **'Budgets'**
  String get budgets;

  /// In en, this message translates to:
  /// **'Budget'**
  String get budget;

  /// In en, this message translates to:
  /// **'New budget'**
  String get newBudget;

  /// In en, this message translates to:
  /// **'Edit budget'**
  String get editBudget;

  /// In en, this message translates to:
  /// **'Budget amount'**
  String get budgetAmount;

  /// In en, this message translates to:
  /// **'Actual'**
  String get actualAmount;

  /// In en, this message translates to:
  /// **'Variance'**
  String get variance;

  /// In en, this message translates to:
  /// **'Variance %'**
  String get variancePercent;

  /// In en, this message translates to:
  /// **'Budget period'**
  String get budgetPeriod;

  /// In en, this message translates to:
  /// **'No budgets yet'**
  String get noBudgets;

  /// In en, this message translates to:
  /// **'Budget saved'**
  String get budgetSaved;

  /// In en, this message translates to:
  /// **'Retire budget'**
  String get retireBudget;

  /// In en, this message translates to:
  /// **'A retired budget keeps its history and leaves the active list. Continue?'**
  String get confirmRetireBudget;

  /// In en, this message translates to:
  /// **'Budget vs actual'**
  String get budgetReport;

  /// In en, this message translates to:
  /// **'Favorable'**
  String get favorable;

  /// In en, this message translates to:
  /// **'Unfavorable'**
  String get unfavorable;

  /// In en, this message translates to:
  /// **'Retired'**
  String get budgetRetired;

  /// In en, this message translates to:
  /// **'Allocation'**
  String get allocation;

  /// In en, this message translates to:
  /// **'Allocations'**
  String get allocations;

  /// In en, this message translates to:
  /// **'Allocated'**
  String get allocated;

  /// In en, this message translates to:
  /// **'Line amount'**
  String get sourceAmount;

  /// In en, this message translates to:
  /// **'Remaining'**
  String get remainingToAllocate;

  /// In en, this message translates to:
  /// **'Split across cost centers'**
  String get splitAcrossCenters;

  /// In en, this message translates to:
  /// **'Allocations must add up to the line amount exactly.'**
  String get allocationMustReconcile;

  /// In en, this message translates to:
  /// **'This cost center is already in the split.'**
  String get duplicateCostCenter;

  /// In en, this message translates to:
  /// **'Select a cost center'**
  String get selectCostCenter;

  /// In en, this message translates to:
  /// **'No cost center'**
  String get noAllocation;

  /// In en, this message translates to:
  /// **'Inactive cost centers cannot receive new postings.'**
  String get costCenterInactive;

  /// In en, this message translates to:
  /// **'Add cost center'**
  String get addAllocation;

  /// In en, this message translates to:
  /// **'Allocated total'**
  String get allocationTotal;

  /// In en, this message translates to:
  /// **'Delete'**
  String get deleteRecord;

  /// In en, this message translates to:
  /// **'Result'**
  String get resultLabel;

  /// In en, this message translates to:
  /// **'en'**
  String get @@locale;

  /// In en, this message translates to:
  /// **'The account “{account}” will be deleted, as long as it has no movements or sub-accounts. Continue?'**
  String get deleteAccountConfirm;

  /// In en, this message translates to:
  /// **'The unit “{unit}” will be deleted. Units with movements cannot be deleted.'**
  String get deleteBranchConfirm;

  /// In en, this message translates to:
  /// **'The file “{file}” will be permanently removed from the server.'**
  String get deleteBackupConfirm;

  /// In en, this message translates to:
  /// **'This will reset “{company}”.'**
  String get resetForCompany;

  /// In en, this message translates to:
  /// **'The only way back is to restore the backup that is about to be taken. Type your password and the word {word} to go ahead.'**
  String get resetConfirmBody;

  /// In en, this message translates to:
  /// **'Type {word}'**
  String get resetWordLabel;

  /// In en, this message translates to:
  /// **'Type {word} exactly as it is written to confirm.'**
  String get resetWrongWord;

  /// In en, this message translates to:
  /// **'The company’s data was cleared. “{file}” holds the old data.'**
  String get resetDone;

  /// In en, this message translates to:
  /// **'Row density'**
  String get rowDensity;

  /// In en, this message translates to:
  /// **'Compact'**
  String get densityCompact;

  /// In en, this message translates to:
  /// **'Normal'**
  String get densityNormal;

  /// In en, this message translates to:
  /// **'Spacious'**
  String get densitySpacious;

  /// In en, this message translates to:
  /// **'Drag a column edge to widen it'**
  String get dragColumnHint;

  /// In en, this message translates to:
  /// **'Nothing to show'**
  String get noRecords;

  /// In en, this message translates to:
  /// **'Resize'**
  String get resizeDialog;

  /// In en, this message translates to:
  /// **'Maximize'**
  String get maximize;

  /// In en, this message translates to:
  /// **'Restore'**
  String get restore;

  /// In en, this message translates to:
  /// **'Available in branch'**
  String get availableInBranch;

  /// In en, this message translates to:
  /// **'The branch\'s actual on-hand balance, the same figure posting checks. Warehouse-level balances are not tracked.'**
  String get branchStockHint;

  /// In en, this message translates to:
  /// **'Stock quantities need the inventory.stock.read permission, so they are not shown.'**
  String get stockNotVisible;

  /// In en, this message translates to:
  /// **'Use'**
  String get useItem;

  /// In en, this message translates to:
  /// **'Invoice discount'**
  String get invoiceDiscount;

  /// In en, this message translates to:
  /// **'Applied before tax and allocated across the lines'**
  String get discountBeforeTaxHint;

  /// In en, this message translates to:
  /// **'No discount'**
  String get noDiscount;

  /// In en, this message translates to:
  /// **'Percentage'**
  String get discountPercent;

  /// In en, this message translates to:
  /// **'Fixed amount'**
  String get discountAmount;

  /// In en, this message translates to:
  /// **'Percent %'**
  String get discountPercentValue;

  /// In en, this message translates to:
  /// **'Amount'**
  String get discountAmountValue;

  /// In en, this message translates to:
  /// **'Line discount'**
  String get lineDiscount;

  /// In en, this message translates to:
  /// **'Before discount'**
  String get beforeDiscount;

  /// In en, this message translates to:
  /// **'Line discounts'**
  String get lineDiscounts;

  /// In en, this message translates to:
  /// **'Net line'**
  String get netLine;

  /// In en, this message translates to:
  /// **'Quotations'**
  String get quotations;

  /// In en, this message translates to:
  /// **'Quotation'**
  String get quotation;

  /// In en, this message translates to:
  /// **'New quotation'**
  String get newQuotation;

  /// In en, this message translates to:
  /// **'Edit quotation'**
  String get editQuotation;

  /// In en, this message translates to:
  /// **'Quotation number'**
  String get quotationNumber;

  /// In en, this message translates to:
  /// **'Quotation date'**
  String get quotationDate;

  /// In en, this message translates to:
  /// **'Valid until'**
  String get validUntil;

  /// In en, this message translates to:
  /// **'Sent'**
  String get sent;

  /// In en, this message translates to:
  /// **'Accepted'**
  String get accepted;

  /// In en, this message translates to:
  /// **'Rejected'**
  String get rejected;

  /// In en, this message translates to:
  /// **'Expired'**
  String get expired;

  /// In en, this message translates to:
  /// **'Converted'**
  String get converted;

  /// In en, this message translates to:
  /// **'Tables'**
  String get quotationTables;

  /// In en, this message translates to:
  /// **'Add table'**
  String get addTable;

  /// In en, this message translates to:
  /// **'Table title'**
  String get tableTitle;

  /// In en, this message translates to:
  /// **'Table discount'**
  String get tableDiscount;

  /// In en, this message translates to:
  /// **'Move up'**
  String get moveUp;

  /// In en, this message translates to:
  /// **'Move down'**
  String get moveDown;

  /// In en, this message translates to:
  /// **'Remove table'**
  String get removeTable;

  /// In en, this message translates to:
  /// **'Add line'**
  String get addQuotationLine;

  /// In en, this message translates to:
  /// **'Country of origin'**
  String get countryOfOrigin;

  /// In en, this message translates to:
  /// **'Origin'**
  String get origin;

  /// In en, this message translates to:
  /// **'Gross value'**
  String get grossValue;

  /// In en, this message translates to:
  /// **'Net value'**
  String get netValue;

  /// In en, this message translates to:
  /// **'Final total'**
  String get finalTotal;

  /// In en, this message translates to:
  /// **'Total discounts'**
  String get totalDiscounts;

  /// In en, this message translates to:
  /// **'Quotation discount'**
  String get quotationDiscount;

  /// In en, this message translates to:
  /// **'Subtotal before discount'**
  String get subtotalBeforeDiscount;

  /// In en, this message translates to:
  /// **'Summary'**
  String get quotationSummary;

  /// In en, this message translates to:
  /// **'Table subtotal'**
  String get tableSubtotal;

  /// In en, this message translates to:
  /// **'Terms and conditions'**
  String get termsAndConditions;

  /// In en, this message translates to:
  /// **'Notes'**
  String get notesLabel;

  /// In en, this message translates to:
  /// **'Company manager'**
  String get managerName;

  /// In en, this message translates to:
  /// **'Responsible person'**
  String get responsibleName;

  /// In en, this message translates to:
  /// **'Responsible telephone'**
  String get responsiblePhone;

  /// In en, this message translates to:
  /// **'Follow up'**
  String get followUp;

  /// In en, this message translates to:
  /// **'What was discussed'**
  String get followUpNote;

  /// In en, this message translates to:
  /// **'Write what was discussed before saving the follow-up.'**
  String get followUpRequired;

  /// In en, this message translates to:
  /// **'History'**
  String get statusHistory;

  /// In en, this message translates to:
  /// **'Issue and mark sent'**
  String get sendQuotation;

  /// In en, this message translates to:
  /// **'Accept'**
  String get acceptQuotation;

  /// In en, this message translates to:
  /// **'Reject'**
  String get rejectQuotation;

  /// In en, this message translates to:
  /// **'Start a revision'**
  String get reviseQuotation;

  /// In en, this message translates to:
  /// **'Convert to invoice'**
  String get convertToInvoice;

  /// In en, this message translates to:
  /// **'Convert'**
  String get convert;

  /// In en, this message translates to:
  /// **'Converted invoice'**
  String get convertedInvoice;

  /// In en, this message translates to:
  /// **'Create a draft sales invoice from this accepted quotation? Nothing is posted and no stock moves until the invoice is posted separately.'**
  String get conversionConfirm;

  /// In en, this message translates to:
  /// **'The quotation total is before tax. The invoice applies the company tax rules, so its total may be higher.'**
  String get conversionTaxNote;

  /// In en, this message translates to:
  /// **'No quotations yet'**
  String get noQuotations;

  /// In en, this message translates to:
  /// **'Print preview'**
  String get printPreview;

  /// In en, this message translates to:
  /// **'Download PDF'**
  String get downloadPdf;

  /// In en, this message translates to:
  /// **'Quotation saved'**
  String get quotationSaved;

  /// In en, this message translates to:
  /// **'Quotation issued and marked as sent'**
  String get quotationSent;

  /// In en, this message translates to:
  /// **'Quotation accepted'**
  String get quotationAccepted;

  /// In en, this message translates to:
  /// **'Quotation rejected'**
  String get quotationRejected;

  /// In en, this message translates to:
  /// **'A new draft revision was created'**
  String get quotationRevised;

  /// In en, this message translates to:
  /// **'Quotation converted to a draft invoice'**
  String get quotationConverted;

  /// In en, this message translates to:
  /// **'Draft quotation removed'**
  String get quotationDeleted;

  /// In en, this message translates to:
  /// **'Remove this draft quotation? Issued quotations are never deleted.'**
  String get deleteQuotationConfirm;

  /// In en, this message translates to:
  /// **'Add at least one table with one line.'**
  String get quotationNeedsTable;

  /// In en, this message translates to:
  /// **'Status'**
  String get filterStatus;

  /// In en, this message translates to:
  /// **'From date'**
  String get fromDate;

  /// In en, this message translates to:
  /// **'To date'**
  String get toDate;

  /// In en, this message translates to:
  /// **'This is a draft: nothing is posted and stock is untouched. Issuing it freezes the content that the customer receives.'**
  String get quotationDraftHint;

  /// In en, this message translates to:
  /// **'Optional'**
  String get optional;

  /// In en, this message translates to:
  /// **'Currency'**
  String get currency;

  /// In en, this message translates to:
  /// **'Clear'**
  String get clear;

  /// In en, this message translates to:
  /// **'Filter by status, customer or date'**
  String get quotationFilterHint;

  /// In en, this message translates to:
  /// **'Documents and quotations'**
  String get documentSettings;

  /// In en, this message translates to:
  /// **'Maximum discount %'**
  String get maximumDiscount;

  /// In en, this message translates to:
  /// **'Print the tax registration number on quotations'**
  String get showTaxIdOnQuotations;

  /// In en, this message translates to:
  /// **'A display choice only. It never deletes the number, and it cannot override a legal requirement to show it.'**
  String get taxIdLegalNote;

  /// In en, this message translates to:
  /// **'Sales manager'**
  String get salesManagerName;

  /// In en, this message translates to:
  /// **'Sales manager telephone'**
  String get salesManagerPhone;

  /// In en, this message translates to:
  /// **'Settings saved'**
  String get settingsSaved;

  /// In en, this message translates to:
  /// **'Save settings'**
  String get saveSettings;

  /// In en, this message translates to:
  /// **'Changing these needs the company administration permission.'**
  String get readOnlySettings;

  /// In en, this message translates to:
  /// **'Enter a value between 0 and 100.'**
  String get invalidSetting;

  /// In en, this message translates to:
  /// **'Network and remote access'**
  String get networkAccessTitle;

  /// In en, this message translates to:
  /// **'The server did not answer its network report. Check that it is running.'**
  String get networkUnavailable;

  /// In en, this message translates to:
  /// **'Available on the local network'**
  String get lanReachable;

  /// In en, this message translates to:
  /// **'This computer only'**
  String get localOnly;

  /// In en, this message translates to:
  /// **'Server'**
  String get serverStatus;

  /// In en, this message translates to:
  /// **'ready, database up'**
  String get serverReady;

  /// In en, this message translates to:
  /// **'database not reachable'**
  String get databaseDown;

  /// In en, this message translates to:
  /// **'Listening on'**
  String get listeningOn;

  /// In en, this message translates to:
  /// **'Local address'**
  String get localAddress;

  /// In en, this message translates to:
  /// **'Network address'**
  String get networkAddress;

  /// In en, this message translates to:
  /// **'Address if enabled'**
  String get wouldBeAddress;

  /// In en, this message translates to:
  /// **'Address copied'**
  String get addressCopied;

  /// In en, this message translates to:
  /// **'Copy address'**
  String get copyAddress;

  /// In en, this message translates to:
  /// **'The server is bound to this computer only, so the addresses below do not answer from another device. To allow the other computers on the network, set HOST=0.0.0.0 in the installation settings file and restart the program.'**
  String get lanNotEnabledHint;

  /// In en, this message translates to:
  /// **'Windows Firewall must also allow the program on private networks. The database port (5432) is never opened: other devices only reach the program, and still have to sign in.'**
  String get lanFirewallHint;

  /// In en, this message translates to:
  /// **'Public (internet) address'**
  String get publicAddressTitle;

  /// In en, this message translates to:
  /// **'Detect'**
  String get detectPublicAddress;

  /// In en, this message translates to:
  /// **'Detected only when you press Detect. A public address alone does not make this server reachable from the internet: the router or the carrier may block incoming connections. For remote use, prefer a VPN or an HTTPS gateway; never expose the database.'**
  String get publicAddressHint;

  /// In en, this message translates to:
  /// **'Checking…'**
  String get publicAddressChecking;

  /// In en, this message translates to:
  /// **'The public address could not be detected.'**
  String get publicAddressUnavailable;

  /// In en, this message translates to:
  /// **'an address alone does not prove that incoming connections reach this computer.'**
  String get publicAddressNotProof;

  /// In en, this message translates to:
  /// **'Last checked'**
  String get lastChecked;

  /// In en, this message translates to:
  /// **'Remove'**
  String get remove;


  /// No description provided for @termsLibrary.
  ///
  /// In en, this message translates to:
  /// **'Saved terms'**
  String get termsLibrary;

  /// No description provided for @insertSavedTerms.
  ///
  /// In en, this message translates to:
  /// **'Insert saved terms'**
  String get insertSavedTerms;

  /// No description provided for @saveTermsToLibrary.
  ///
  /// In en, this message translates to:
  /// **'Save terms to library'**
  String get saveTermsToLibrary;

  /// No description provided for @termsTitle.
  ///
  /// In en, this message translates to:
  /// **'Entry title'**
  String get termsTitle;

  /// No description provided for @termsBody.
  ///
  /// In en, this message translates to:
  /// **'Terms text'**
  String get termsBody;

  /// No description provided for @noSavedTerms.
  ///
  /// In en, this message translates to:
  /// **'No saved terms yet. Write the terms below and save them for reuse.'**
  String get noSavedTerms;

  /// No description provided for @termsSaved.
  ///
  /// In en, this message translates to:
  /// **'Terms saved to the library'**
  String get termsSaved;

  /// No description provided for @manageSavedTerms.
  ///
  /// In en, this message translates to:
  /// **'Manage saved terms'**
  String get manageSavedTerms;

  /// No description provided for @termsInserted.
  ///
  /// In en, this message translates to:
  /// **'Saved terms inserted. You can edit this copy freely.'**
  String get termsInserted;

  /// No description provided for @removeSavedTerm.
  ///
  /// In en, this message translates to:
  /// **'Remove this saved entry? Documents that already used it keep their own copy.'**
  String get removeSavedTerm;

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
  /// In en, this message translates to:
  /// **'Item code'**
  String get itemCode;

  /// In en, this message translates to:
  /// **'Subject'**
  String get subject;

  /// In en, this message translates to:
  /// **'The headline of this offer, printed above the customer\'s name.'**
  String get subjectHint;

  /// In en, this message translates to:
  /// **'Print the company tax number on this offer'**
  String get showTaxNumberOnOffer;

  /// In en, this message translates to:
  /// **'The company setting is only the default; this offer keeps its own choice.'**
  String get showTaxNumberOnOfferHint;

  /// In en, this message translates to:
  /// **'Line columns'**
  String get quotationColumns;

  /// In en, this message translates to:
  /// **'Column layout'**
  String get columnLayout;

  /// In en, this message translates to:
  /// **'Choose, rename, order and size the columns this offer prints.'**
  String get columnLayoutHint;

  /// In en, this message translates to:
  /// **'English label'**
  String get columnLabelEn;

  /// In en, this message translates to:
  /// **'Arabic label'**
  String get columnLabelAr;

  /// In en, this message translates to:
  /// **'Width'**
  String get columnWidth;

  /// In en, this message translates to:
  /// **'Add column'**
  String get addColumn;

  /// In en, this message translates to:
  /// **'Remove column'**
  String get removeColumn;

  /// In en, this message translates to:
  /// **'Saved layout'**
  String get columnTemplate;

  /// In en, this message translates to:
  /// **'New layout name'**
  String get templateName;

  /// In en, this message translates to:
  /// **'Save as a layout'**
  String get saveColumnTemplate;

  /// In en, this message translates to:
  /// **'Layout saved to the library'**
  String get templateSaved;

  /// In en, this message translates to:
  /// **'Keep at least one column visible.'**
  String get keepOneColumnVisible;
  /// In en, this message translates to:
  /// **'Printed'**
  String get printedOnOffer;

  /// In en, this message translates to:
  /// **'Not printed'**
  String get notPrintedOnOffer;
}
