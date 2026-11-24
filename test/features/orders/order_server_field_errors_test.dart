import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/orders/presentation/order_create_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../widget/test_harness.dart';

class _CreateApi extends ApiClient {
  _CreateApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final requests = <Map<String, dynamic>>[];
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/inventory/items') return [{'id': 'item-1', 'code': 'I', 'nameEn': 'Synthetic item', 'unit': 'piece', 'isActive': true}];
    return [{'id': 'party-1', 'code': 'P', 'nameEn': 'Synthetic party', 'isActive': true}];
  }
  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    requests.add(Map<String, dynamic>.from(body! as Map));
    throw const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED',
        fieldErrors: {'lines.0.quantity': 'الكمية أكبر من المتاح', 'orderDate': 'التاريخ خارج الفترة المفتوحة'});
  }
}

void main() {
  testWidgets('order server field errors land on the fields and input is kept', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _CreateApi();
    const user = AppUser(id: 'user', username: 'tester', fullName: 'Tester', companyId: 'company', branchId: 'branch', isSuperAdmin: true);
    await tester.pumpWidget(ProviderScope(overrides: [
      apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWith((ref) => user),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
    ], child: MaterialApp(locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Builder(builder: (context) => Scaffold(body: TextButton(
        onPressed: () => Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const OrderCreateScreen(kind: InvoiceKind.sales))),
        child: const Text('Open order'),
      ))))));
    await tester.tap(find.text('Open order'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('P — Synthetic party').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('I — Synthetic item').last);
    await tester.pumpAndSettle();
    final quantity = find.widgetWithText(TextFormField, 'Quantity');
    await tester.ensureVisible(quantity);
    await tester.enterText(quantity, '2');
    await tester.ensureVisible(find.text('Save draft order'));
    await tester.tap(find.text('Save draft order'));
    await tester.pumpAndSettle();
    expect(api.requests, hasLength(1));
    expect(find.text('الكمية أكبر من المتاح'), findsOneWidget);
    expect(find.text('التاريخ خارج الفترة المفتوحة'), findsOneWidget);
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.widget<TextFormField>(quantity).controller!.text, '2');
    // Editing the quantity clears only its own reason.
    await tester.enterText(quantity, '1');
    await tester.pump();
    expect(find.text('الكمية أكبر من المتاح'), findsNothing);
    expect(find.text('التاريخ خارج الفترة المفتوحة'), findsOneWidget);
  });
}
