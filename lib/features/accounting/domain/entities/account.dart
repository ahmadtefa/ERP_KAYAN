import 'account_type.dart';

/// A single node of the Chart of Accounts.
///
/// [parentId] forms a self-referencing tree; [isPostable] is false for
/// grouping nodes so that journal lines can only target leaf accounts.
class Account {
  const Account({
    required this.id,
    required this.companyId,
    required this.code,
    required this.name,
    required this.type,
    this.parentId,
    this.isPostable = true,
    this.isActive = true,
    this.currency,
  });

  final String id;
  final String companyId;
  final String code;
  final String name;
  final AccountType type;
  final String? parentId;
  final bool isPostable;
  final bool isActive;
  final String? currency;

  bool get isLeaf => isPostable;

  Account copyWith({String? name, bool? isActive, bool? isPostable}) => Account(
    id: id,
    companyId: companyId,
    code: code,
    name: name ?? this.name,
    type: type,
    parentId: parentId,
    isPostable: isPostable ?? this.isPostable,
    isActive: isActive ?? this.isActive,
    currency: currency,
  );

  @override
  String toString() => 'Account($code $name, $type)';
}
