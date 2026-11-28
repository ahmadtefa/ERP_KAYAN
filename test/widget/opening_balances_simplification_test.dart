import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/opening_balances_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _OpeningApi extends ApiClient {
  _OpeningApi({required this.detail})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final Map<String, dynamic> detail;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => detail;
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  branchId: 'b',
  isSuperAdmin: true,
  permissions: [
    'accounting.openingbalances.manage',
    'accounting.accounts.read',
  ],
);

Future<void> _pump(
  WidgetTester tester,
  Map<String, dynamic> detail, {
  String? documentId,
}) async {
  tester.view.physicalSize = const Size(1500, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_OpeningApi(detail: detail)),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: OpeningBalancesScreen(documentId: documentId)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an empty list says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, {'items': const <Object>[]});

    expect(
      find.textContaining('No opening-balance drafts yet'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a draft shows its date with the year and its amounts with two '
      'decimals', (tester) async {
    await _pump(
      tester,
      {
        'id': 'doc-1',
        'documentNumber': 'OB-1',
        'status': 'draft',
        'asOfDate': '2026-02-01',
        'totalDebit': '1234.5',
        'totalCredit': '1234.5',
        'lines': [
          {
            'accountCode': '1101',
            'accountNameEn': 'Cash',
            'debit': '1234.5',
            'credit': '0',
          },
        ],
      },
      documentId: 'doc-1',
    );

    expect(find.textContaining('February 1, 2026'), findsOneWidget);
    expect(find.textContaining('2026-02-01'), findsNothing);
    expect(find.textContaining('1,234.50'), findsWidgets);
    expect(find.textContaining('0.00'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
