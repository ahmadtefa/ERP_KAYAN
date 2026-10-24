import '../../../../shared/utils/account_name.dart';
import 'account_type.dart';

/// A single node of the Chart of Accounts.
///
/// [parentId] forms a self-referencing tree; [isPostable] is false for
/// grouping nodes so that journal lines can only target leaf accounts.
///
/// The account carries both names the company gave it. Which one a screen
/// shows is decided by `accountName()` in `shared/utils/account_name.dart` —
/// the same rule everywhere.
class Account implements AccountNames {
  const Account({
    required this.id,
    required this.companyId,
    required this.code,
    required this.name,
    required this.type,
    this.nameEn,
    this.nameAr,
    this.parentId,
    this.isPostable = true,
    this.isActive = true,
    this.currency,
    this.description,
    this.cashFlowClass,
  });

  final String id;
  final String companyId;
  @override
  final String code;

  /// The default name (English). Kept for compatibility; prefer
  /// `accountName(this, languageCode)`.
  final String name;

  @override
  final String? nameEn;
  @override
  final String? nameAr;

  final AccountType type;
  final String? parentId;
  final bool isPostable;
  final bool isActive;
  final String? currency;

  /// Free-text note on the account (desktop expense accounts keep one).
  final String? description;

  /// Where this account's cash movements belong in the cash-flow
  /// statement: 'OPERATING', 'INVESTING' or 'FINANCING'. Null means the
  /// accountant has not classified it — the statement then shows the
  /// movement as unclassified instead of guessing.
  final String? cashFlowClass;

  bool get isLeaf => isPostable;

  Account copyWith({
    String? name,
    String? nameEn,
    String? nameAr,
    bool? isActive,
    bool? isPostable,
    String? parentId,
    String? code,
  }) => Account(
    id: id,
    companyId: companyId,
    code: code ?? this.code,
    name: name ?? this.name,
    nameEn: nameEn ?? this.nameEn,
    nameAr: nameAr ?? this.nameAr,
    type: type,
    parentId: parentId ?? this.parentId,
    isPostable: isPostable ?? this.isPostable,
    isActive: isActive ?? this.isActive,
    currency: currency,
    description: description,
  );

  @override
  String toString() => 'Account($code $name, $type)';
}
