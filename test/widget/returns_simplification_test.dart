import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/returns_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _ReturnsApi extends ApiClient {
  _ReturnsApi(this.rows)
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final List<Map<String, dynamic>> rows;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => rows;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => rows.isEmpty ? const {} : rows.first;
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
  _ReturnsApi api,
  InvoiceKind kind,
) async {
  tester.view.physicalSize = const Size(1700, 1000);
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
        home: Scaffold(body: ReturnsScreen(kind: kind)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a return shows its date as a reader says it', (tester) async {
    final api = _ReturnsApi([
      {
        'id': 'r1',
        'invoiceNumber': 'RET-1',
        'invoiceDate': '2026-02-03',
        'status': 'draft',
        'totalAmount': '5',
      },
    ]);
    await _pump(tester, api, InvoiceKind.sales);

    expect(find.text('February 3, 2026'), findsWidgets);
    expect(find.text('2026-02-03'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty returns list says what to do next', (tester) async {
    await _pump(tester, _ReturnsApi(const []), InvoiceKind.sales);

    expect(find.textContaining('No returns yet. Choose "'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
