import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/commissions/presentation/commissions_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _RowsApi extends ApiClient {
  _RowsApi(this.rows)
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final Map<String, List<Map<String, dynamic>>> rows;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => rows[path] ?? const [];

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {};
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  branchId: 'b',
  isSuperAdmin: true,
);

Future<void> _pump(
  WidgetTester tester,
  _RowsApi api,
  Widget screen,
) async {
  tester.view.physicalSize = const Size(2000, 1300);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: screen,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a commission row shows the date and the money as figures', (
    tester,
  ) async {
    final api = _RowsApi({
      '/commissions/entries': [
        {
          'id': 'e1',
          'invoiceNumber': 'INV-1',
          'documentDate': '2026-02-03',
          'repEn': 'Rep',
          'basis': '1000',
          'ratePercent': '5',
          'amount': '50',
          'status': 'ACCRUED',
          'kind': 'SALE',
        },
      ],
    });
    await _pump(tester, api, const CommissionsScreen());

    expect(find.textContaining('February 3, 2026'), findsOneWidget);
    expect(find.textContaining('1,000.00'), findsWidgets);
    expect(find.textContaining('50.00'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
