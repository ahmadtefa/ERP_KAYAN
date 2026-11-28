import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
}

Future<void> _open(
  WidgetTester tester, {
  required InvoiceKind kind,
  required Locale locale,
}) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_FakeApiClient()),
        activeItemsProvider.overrideWith((ref) async => []),
        activeCustomersProvider.overrideWith((ref) async => []),
        activeSuppliersProvider.overrideWith((ref) async => []),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: InvoiceEditorScreen(kind: kind),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('sales editor shows grouped headers and one-line helpers in Arabic',
      (tester) async {
    await _open(tester, kind: InvoiceKind.sales, locale: const Locale('ar'));

    expect(find.text('بيانات الفاتورة'), findsOneWidget);
    expect(find.text('الخصم على الفاتورة كلها'), findsOneWidget);
    expect(find.text('تاريخ إصدار الفاتورة'), findsOneWidget);
    expect(find.text('العميل الذي تُسجَّل عليه الفاتورة'), findsOneWidget);
    // The discount helper that already existed is still there.
    expect(find.text('يُطبق قبل الضريبة ويُوزع على البنود'), findsOneWidget);
  });

  testWidgets('purchase editor shows supplier helpers and a single save button',
      (tester) async {
    await _open(tester, kind: InvoiceKind.purchase, locale: const Locale('ar'));

    expect(find.text('المورد الذي تُسجَّل عليه الفاتورة'), findsOneWidget);
    expect(find.text('رقم فاتورة المورد إن وُجد'), findsOneWidget);
    expect(find.text('حفظ'), findsOneWidget);
  });

  testWidgets('English editor keeps its labels and adds the same helpers',
      (tester) async {
    await _open(tester, kind: InvoiceKind.sales, locale: const Locale('en'));

    expect(find.text('Invoice details'), findsOneWidget);
    expect(find.text('The day the invoice is issued'), findsOneWidget);
    expect(find.text('Save'), findsOneWidget);
  });
}
