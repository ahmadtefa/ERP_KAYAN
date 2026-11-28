import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cheques/presentation/cheques_screen.dart';
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

  testWidgets('a cheque shows its due date and amount as a reader says them', (
    tester,
  ) async {
    final api = _RowsApi({
      '/cheques': [
        {
          'id': 'c1',
          'direction': 'RECEIVED',
          'chequeNumber': 'CH-1',
          'bankName': 'Bank',
          'partyNameEn': 'Party',
          'dueDate': '2026-02-03',
          'amount': '1500',
          'status': 'HELD',
          'overdue': false,
        },
      ],
    });
    await _pump(tester, api, const ChequesScreen());

    expect(find.textContaining('February 3, 2026'), findsOneWidget);
    expect(find.textContaining('1,500.00'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
