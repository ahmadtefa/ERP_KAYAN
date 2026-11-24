import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_transfers_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final posts = <Map<String, dynamic>>[];
  final keys = <String?>[];
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'w1', 'code': 'W1', 'nameEn': 'Main', 'nameAr': 'الرئيسي'},
        {'id': 'w2', 'code': 'W2', 'nameEn': 'Second', 'nameAr': 'الثاني'},
      ];
    }
    if (path == '/inventory/items') {
      return [
        {'id': 'i1', 'code': 'IT', 'nameEn': 'Item', 'nameAr': 'صنف', 'unit': 'piece'},
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posts.add(Map<String, dynamic>.from(body! as Map));
    keys.add(idempotencyKey);
    if (posts.length == 1) throw const NetworkFailure();
    if (posts.length == 2) {
      throw const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED',
          fieldErrors: {'reason': 'السبب قصير جدا', 'lines.0.quantity': 'الكمية أكبر من الرصيد'});
    }
    return {'id': 't1'};
  }
}

void main() {
  testWidgets('transfer request: missing fields are named, server refusals stay in the dialog, retry reuses the key', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _Api();
    final router = GoRouter(initialLocation: '/transfers', routes: [
      GoRoute(path: '/transfers', builder: (_, _) => const StockTransfersScreen()),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWithValue(const AppUser(id: 'u', username: 'u', fullName: 'U', companyId: 'c', branchId: 'b', isSuperAdmin: true))],
      child: MaterialApp.router(locale: const Locale('en'), localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales, routerConfig: router),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request transfer'));
    await tester.pumpAndSettle();

    // Empty form: it used to do nothing. Now every missing field says so.
    await tester.tap(find.text('Create request'));
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsWidgets);
    expect(api.posts, isEmpty);

    Future<void> pick(String label, String option) async {
      await tester.tap(find.text(label).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text(option).last);
      await tester.pumpAndSettle();
    }
    await pick('Source warehouse', 'W1 · Main');
    await pick('Destination warehouse', 'W2 · Second');
    await pick('Item', 'IT · Item');
    await tester.enterText(find.widgetWithText(TextField, 'Transfer reason'), 'Restock');
    await tester.tap(find.text('Create request'));
    await tester.pumpAndSettle();

    // 1) Network failure: dialog stays open with input, request not lost.
    expect(api.posts, hasLength(1));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('Create request'), findsOneWidget);
    // 2) Retry: same body, same key.
    await tester.tap(find.text('Create request'));
    await tester.pumpAndSettle();
    expect(api.posts, hasLength(2));
    expect(api.posts[1], api.posts[0]);
    expect(api.keys[1], api.keys[0]);
    // 3) Server refusal: reasons under the fields, dialog open, input kept.
    expect(find.text('السبب قصير جدا'), findsOneWidget);
    expect(find.text('الكمية أكبر من الرصيد'), findsOneWidget);
    expect(tester.widget<TextField>(find.widgetWithText(TextField, 'Transfer reason')).controller!.text, 'Restock');
    // 4) Correct the reason and send again: new key, success, dialog closes.
    await tester.enterText(find.widgetWithText(TextField, 'Transfer reason'), 'Restock for the weekend');
    await tester.pump();
    expect(find.text('السبب قصير جدا'), findsNothing);
    await tester.tap(find.text('Create request'));
    await tester.pumpAndSettle();
    expect(api.posts, hasLength(3));
    expect(api.keys[2], isNot(api.keys[0]));
    expect(find.text('Create request'), findsNothing);
  });
}
