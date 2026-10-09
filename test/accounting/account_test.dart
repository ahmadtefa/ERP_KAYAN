import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:flutter_test/flutter_test.dart';

const account = Account(
  id: 'a1',
  companyId: 'c1',
  code: '1101',
  name: 'Cash on hand',
  type: AccountType.asset,
);

void main() {
  group('AccountType', () {
    test('debit-normal accounts increase with a debit', () {
      expect(AccountType.asset.increasesWithDebit, isTrue);
      expect(AccountType.expense.increasesWithDebit, isTrue);
    });

    test('credit-normal accounts do not increase with a debit', () {
      expect(AccountType.liability.increasesWithDebit, isFalse);
      expect(AccountType.equity.increasesWithDebit, isFalse);
      expect(AccountType.revenue.increasesWithDebit, isFalse);
    });
  });

  group('Account', () {
    test('defaults to an active postable leaf', () {
      expect(account.isPostable, isTrue);
      expect(account.isLeaf, isTrue);
      expect(account.isActive, isTrue);
      expect(account.parentId, isNull);
    });

    test('copyWith changes only what is supplied', () {
      final renamed = account.copyWith(name: 'Petty cash');
      expect(renamed.name, 'Petty cash');
      expect(renamed.code, account.code);
      expect(renamed.type, account.type);
      expect(renamed.id, account.id);
    });

    test('copyWith can demote a node to a grouping account', () {
      final group = account.copyWith(isPostable: false);
      expect(group.isPostable, isFalse);
      expect(group.isLeaf, isFalse);
    });

    test('a grouping node is not a leaf', () {
      const parent = Account(
        id: 'a0',
        companyId: 'c1',
        code: '11',
        name: 'Current assets',
        type: AccountType.asset,
        isPostable: false,
      );
      expect(parent.isPostable, isFalse);
      expect(parent.isLeaf, isFalse);
    });
  });
}
