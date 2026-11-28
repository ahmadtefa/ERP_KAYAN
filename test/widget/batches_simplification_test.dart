import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/batches_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _BatchesApi extends ApiClient {
  _BatchesApi({this.rows = const []})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final List<Map<String, dynamic>> rows;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => path == '/inventory/batches' ? rows : const [];
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  branchId: 'b',
  isSuperAdmin: true,
);

Future<void> _pump(WidgetTester tester, List<Map<String, dynamic>> rows) async {
  tester.view.physicalSize = const Size(1700, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_BatchesApi(rows: rows)),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: BatchesScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an empty lot list says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, const []);

    expect(find.textContaining('No batches to show'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a lot shows its expiry as a date with the year', (tester) async {
    await _pump(tester, [
      {
        'id': 'b1',
        'batchNumber': 'LOT-A',
        'item': {'nameEn': 'Cable', 'nameAr': 'كابل'},
        'warehouse': {'nameEn': 'Main store', 'nameAr': 'المخزن'},
        'remainingQuantity': '10',
        'unitCost': '2',
        'value': '20',
        'expiryDate': '2026-12-01T00:00:00.000Z',
        'daysToExpiry': 30,
        'status': 'ACTIVE',
      },
    ]);

    expect(find.text('December 1, 2026'), findsOneWidget);
    expect(find.textContaining('2026-12-01'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
