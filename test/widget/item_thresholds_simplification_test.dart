import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/item_thresholds_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _ThresholdsApi extends ApiClient {
  _ThresholdsApi({this.rows = const []})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final List<Map<String, dynamic>> rows;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => path == '/inventory/item-thresholds' ? rows : const [];
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
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
        apiClientProvider.overrideWithValue(_ThresholdsApi(rows: rows)),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: ItemThresholdsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an empty threshold list says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, const []);

    expect(find.textContaining('No thresholds have been set yet'), findsOneWidget);
    expect(find.textContaining('Add items and warehouses first'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the threshold form groups its fields under a short heading', (
    tester,
  ) async {
    await _pump(tester, [
      {
        'warehouseId': 'wh-1',
        'itemId': 'it-1',
        'item': {'nameEn': 'Cable', 'nameAr': 'كابل'},
        'warehouse': {'nameEn': 'Main store', 'nameAr': 'المخزن'},
        'onHand': '5',
        'minQuantity': '10',
        'reorderQuantity': '0',
        'maxQuantity': '100',
        'suggestedOrder': '5',
        'isBelowMinimum': true,
      },
    ]);

    await tester.tap(find.byTooltip('Edit').first);
    await tester.pumpAndSettle();

    expect(find.text('Limits'), findsOneWidget);
    expect(
      find.text('Below this number the item shows as under its minimum.'),
      findsOneWidget,
    );
    expect(find.text('Set thresholds'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
