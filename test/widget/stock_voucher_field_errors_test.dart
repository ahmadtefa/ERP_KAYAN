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
    if (posts.length == 1) throw const NetworkFailure();
    if (posts.length == 3) return {'id': 'voucher-1'};
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
        home: Builder(builder: (context) => Scaffold(body: TextButton(
          onPressed: () => Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const StockVoucherCreateScreen(kind: 'RECEIPT'))),
          child: const Text('Open voucher'),
        ))),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open voucher'));
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

    // First send: network failure. The request is kept as uncertain.
    expect(api.posts, hasLength(1));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('Retry'), findsOneWidget);
    // Retry sends the SAME request with the SAME idempotency key.
    await tester.ensureVisible(find.text('Retry'));
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(api.posts, hasLength(2));
    expect(api.posts[1], api.posts[0]);
    expect(api.posts[0]['idempotencyKey'], isA<String>());
    // The server then refuses the content: the uncertain request is final.
    expect(find.text('Retry'), findsNothing);
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

    // Correct the cost and save again: a NEW request (new key), and it succeeds once.
    await type('Base unit cost', '6');
    final saveAgain = find.byType(FilledButton).last;
    await tester.ensureVisible(saveAgain);
    await tester.tap(saveAgain);
    await tester.pumpAndSettle();
    expect(api.posts, hasLength(3));
    expect(api.posts[2]['idempotencyKey'], isNot(api.posts[0]['idempotencyKey']));
    expect((api.posts[2]['lines'] as List).single['unitCost'], '6');
    expect(find.text('Open voucher'), findsOneWidget);
  });
}
