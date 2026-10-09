import '../../domain/entities/account.dart';
import '../../domain/entities/account_type.dart';

/// Maps the API representation of an account onto the [Account] entity.
class AccountDto {
  const AccountDto(this.json);

  final Map<String, dynamic> json;

  static AccountType parseType(String? raw) {
    return switch (raw?.toLowerCase()) {
      'asset' || 'assets' => AccountType.asset,
      'liability' || 'liabilities' => AccountType.liability,
      'equity' => AccountType.equity,
      'revenue' || 'income' => AccountType.revenue,
      'expense' || 'expenses' => AccountType.expense,
      _ => AccountType.asset,
    };
  }

  Account toDomain() {
    final id = json['id']?.toString();
    final code = json['code']?.toString();
    final name = (json['name'] ?? json['nameEn'])?.toString();
    if (id == null || code == null || name == null) {
      throw const FormatException(
        'Account payload is missing id, code or name',
      );
    }
    return Account(
      id: id,
      companyId: (json['companyId'] ?? json['company_id'] ?? '').toString(),
      code: code,
      name: name,
      type: parseType((json['type'] ?? json['accountType'])?.toString()),
      parentId: (json['parentId'] ?? json['parent_id'])?.toString(),
      isPostable:
          json['isPostable'] as bool? ?? json['is_postable'] as bool? ?? true,
      isActive: json['isActive'] as bool? ?? json['is_active'] as bool? ?? true,
      currency: json['currency']?.toString(),
    );
  }

  static List<Account> listFrom(List<dynamic> json) => json
      .whereType<Map<String, dynamic>>()
      .map(AccountDto.new)
      .map((dto) => dto.toDomain())
      .toList(growable: false);
}
