import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_vouchers_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final posts = <Map<String, dynamic>>[];
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {'blocked': false};
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/inventory/items') {
      return [
        {'id': 'item', 'code': 'IT', 'nameEn': 'Item', 'unit': 'piece'},
      ];
    }
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'warehouse', 'code': 'WH', 'nameEn': 'Warehouse'},
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posts.add(Map<String, dynamic>.from(body! as Map));
    throw const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED', fieldErrors: {
      'reason': 'السبب غير مقبول لهذا النوع',
      'lines.0.unitCost': 'التكلفة يجب ألا تقل عن صفر',
    });
  }
}

void main() {
  testWidgets('voucher server field errors land on the fields and input is kept', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _Api();
    const user = AppUser(
        id: 'u', username: 'u', fullName: 'U', companyId: 'c', branchId: 'b', isSuperAdmin: true);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const StockVoucherCreateScreen(kind: 'RECEIPT'),
      ),
    ));
    await tester.pumpAndSettle();

    Future<void> pick(String label, String option) async {
      final field = find.text(label).first;
      await tester.ensureVisible(field);
      await tester.tap(field);
      await tester.pumpAndSettle();
      await tester.tap(find.text(option).last);
      await tester.pumpAndSettle();
    }

    Future<void> type(String label, String value) async {
      final field = find.widgetWithText(TextFormField, label);
      await tester.ensureVisible(field);
      await tester.enterText(field, value);
    }

    await pick('Warehouse', 'WH • Warehouse');
    await type('Counterparty', 'Supplier');
    await type('Reason', 'Opening');
    await pick('Item', 'IT • Item');
    await type('Quantity in base units', '3');
    await type('Base unit cost', '5');
    final save = find.byType(FilledButton).last;
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();

    expect(api.posts, hasLength(1));
    expect(find.text('السبب غير مقبول لهذا النوع'), findsOneWidget);
    expect(find.text('التكلفة يجب ألا تقل عن صفر'), findsOneWidget);
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Reason')).controller!.text, 'Opening');
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Base unit cost')).controller!.text, '5');

    // Editing the reason clears only that reason.
    await type('Reason', 'Opening stock');
    await tester.pump();
    expect(find.text('السبب غير مقبول لهذا النوع'), findsNothing);
    expect(find.text('التكلفة يجب ألا تقل عن صفر'), findsOneWidget);
  });
}
