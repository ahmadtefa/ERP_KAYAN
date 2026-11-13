import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/opening_balance_draft_dialog.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  Map<String, dynamic>? saved;
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'currency': 'EGP'};
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => switch (path) {
    '/company/branches' => [
      {'id': 'branch', 'code': '01', 'nameEn': 'Main'},
    ],
    '/accounting/chart-of-accounts' => [
      {
        'id': 'ledger',
        'code': '1101',
        'nameEn': 'Cash ledger',
        'isPostable': true,
      },
      {
        'id': 'ledger2',
        'code': '1102',
        'nameEn': 'Bank ledger',
        'isPostable': true,
      },
    ],
    '/cash/accounts' => [
      {
        'id': 'cash',
        'accountId': 'ledger',
        'code': 'C1',
        'nameEn': 'Cash box',
        'currency': 'EGP',
      },
      {
        'id': 'bank',
        'accountId': 'ledger2',
        'code': 'B1',
        'nameEn': 'Bank account',
        'currency': 'EGP',
      },
    ],
    _ => [],
  };
  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    expect(path, '/accounting/opening-balances');
    saved = Map<String, dynamic>.from(body! as Map);
    return {'id': 'draft'};
  }
}

void main() {
  testWidgets(
    'manual opening balances submit two cash and bank lines at four decimals',
    (tester) async {
      tester.view.physicalSize = const Size(1600, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _Api();
      const user = AppUser(
        id: 'user',
        username: 'test',
        fullName: 'Test',
        companyId: 'company',
        isSuperAdmin: true,
        branchId: 'branch',
      );
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => showOpeningBalanceDraft(context, api, user),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      expect(find.text('Opening balance draft'), findsOneWidget);
      await tester.tap(find.text('Add line'));
      await tester.pumpAndSettle();
      final cashPickers = find.widgetWithText(
        DropdownButtonFormField<String>,
        'Bank or cash',
      );
      await tester.tap(cashPickers.first);
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('Cash box').last);
      await tester.pumpAndSettle();
      await tester.tap(cashPickers.last);
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('Bank account').last);
      await tester.pumpAndSettle();
      final debitFields = find.widgetWithText(TextField, 'Debit');
      await tester.enterText(debitFields.first, '0.1001');
      await tester.enterText(debitFields.last, '0.2002');
      await tester.pumpAndSettle();
      expect(find.textContaining('0.3003'), findsOneWidget);
      await tester.tap(find.text('Save draft for review'));
      await tester.pumpAndSettle();
      expect(api.saved!['branchId'], 'branch');
      expect(api.saved!['currency'], 'EGP');
      expect(api.saved!['autoBalanceToEquity'], true);
      expect(api.saved!['lines'], [
        {'accountId': 'ledger', 'debit': '0.1001', 'credit': '0.0000'},
        {'accountId': 'ledger2', 'debit': '0.2002', 'credit': '0.0000'},
      ]);
      expect(find.text('Opening balance draft'), findsNothing);
    },
  );
}
