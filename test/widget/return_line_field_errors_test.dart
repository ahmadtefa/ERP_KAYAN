import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/return_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  int posts = 0;
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {'blocked': false};
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [
        {'id': 'invoice', 'invoiceNumber': 'INV-1', 'invoiceDate': '2026-01-01', 'status': 'posted', 'branchId': 'branch'},
      ];
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => {
        'id': 'invoice', 'invoiceNumber': 'INV-1', 'invoiceDate': '2026-01-01',
        'lines': [
          {'id': 'line', 'description': 'Synthetic item', 'quantity': '5', 'returnedQuantity': '0', 'unit': 'unit'},
        ],
      };
  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posts++;
    throw const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED',
        fieldErrors: {'lines.0.quantity': 'الكمية أكبر من المتاح للإرجاع'});
  }
}

void main() {
  testWidgets('return quantity problems are shown under the field and input is kept', (tester) async {
    tester.view.physicalSize = const Size(1500, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _Api();
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWithValue(const AppUser(
          id: 'u', username: 'u', fullName: 'u', companyId: 'c', branchId: 'branch', isSuperAdmin: true)),
    ]);
    addTearDown(container.dispose);
    final router = GoRouter(initialLocation: '/return', routes: [
      GoRoute(
        path: '/return',
        onExit: (_, state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder: (context, state) => Scaffold(
            body: ReturnEditorScreen(kind: InvoiceKind.sales, navigationKey: state.pageKey)),
      ),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        )));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('INV-1').last);
    await tester.pumpAndSettle();

    final qty = find.widgetWithText(TextField, 'Quantity to return');
    expect(qty, findsOneWidget);
    final save = find.byIcon(Icons.save_outlined);

    // Client check: more than remains.
    await tester.enterText(qty, '9');
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.textContaining('5'), findsWidgets);
    expect(tester.widget<TextField>(qty).decoration!.errorText, isNotNull);
    expect(api.posts, 0);
    expect(tester.widget<TextField>(qty).controller!.text, '9');

    // Editing clears the mark.
    await tester.enterText(qty, '2');
    await tester.pump();
    expect(tester.widget<TextField>(qty).decoration!.errorText, isNull);

    await tester.pump(const Duration(seconds: 8));
    await tester.pumpAndSettle();

    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    // Server check: reason lands on the same field, input stays.
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(api.posts, 1);
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.widget<TextField>(qty).decoration!.errorText, 'الكمية أكبر من المتاح للإرجاع');
    expect(tester.widget<TextField>(qty).controller!.text, '2');
  });
}
