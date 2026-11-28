import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_detail_dialog.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _DetailApi extends ApiClient {
  _DetailApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {};

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.contains('capabilities')) {
      return {
        'formats': ['xlsx', 'csv'],
        'pdf': false,
      };
    }
    return {
      'id': 'inv-1',
      'invoiceNumber': 'PI-1',
      'status': 'posted',
      'invoiceDate': '2025-03-01',
      'lines': <Map<String, dynamic>>[],
    };
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an invoice document shows its date as a reader says it', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_DetailApi()),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              branchId: 'b',
              isSuperAdmin: true,
            ),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(
            body: SizedBox(
              height: 760,
              child: InvoiceDetailDialog(
                kind: InvoiceKind.purchase,
                summary: {'id': 'inv-1', 'invoiceNumber': 'PI-1'},
              ),
            ),
          ),
        ),
      ),
    );
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(find.text('March 1, 2025'), findsOneWidget);
    expect(find.text('2025-03-01'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
