import 'dart:async';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_list_screen.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/returns_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/budgets_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/cost_centers_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _RefreshApi extends ApiClient {
  _RefreshApi()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://refresh-test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  final refreshRows = Completer<List<Map<String, dynamic>>>();
  final refreshPage = Completer<Map<String, dynamic>>();
  int loads = 0;
  late String path;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) {
    this.path = path;
    loads++;
    if (loads == 1) {
      return Future.value([_row('OLD-1')]);
    }
    return refreshRows.future;
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) {
    this.path = path;
    loads++;
    if (loads == 1)
      return Future.value({
        'items': [_row('OLD-1')],
      });
    return refreshPage.future;
  }
}

Map<String, dynamic> _row(String code) => {
  'id': 'row-$code',
  'invoiceNumber': code,
  'entryNumber': code,
  'code': code,
  'nameEn': 'Name $code',
  'nameAr': 'Name $code',
  'invoiceDate': '2026-11-01',
  'entryDate': '2026-11-01',
  'periodStart': '2026-01-01',
  'periodEnd': '2026-12-31',
  'totalAmount': '10',
  'totalDebit': '10',
  'totalCredit': '10',
  'amount': '10',
  'status': 'draft',
  'isActive': true,
  'type': 'DEPARTMENT',
  'account': {'code': code, 'nameEn': 'Name $code', 'nameAr': 'Name $code'},
  'costCenter': {'code': code, 'nameEn': 'Name $code', 'nameAr': 'Name $code'},
};

void main() {
  final screens =
      <({String name, String path, Widget Function() build, bool object})>[
        (
          name: 'invoice',
          path: '/sales/invoices',
          build: () => const InvoiceListScreen(kind: InvoiceKind.sales),
          object: false,
        ),
        (
          name: 'return',
          path: '/returns/sales',
          build: () => const ReturnsScreen(kind: InvoiceKind.sales),
          object: false,
        ),
        (
          name: 'budget',
          path: '/accounting/budgets',
          build: () => const BudgetsScreen(),
          object: true,
        ),
        (
          name: 'cost center',
          path: '/accounting/cost-centers/tree',
          build: () => const CostCentersScreen(),
          object: true,
        ),
        (
          name: 'journal',
          path: '/accounting/journal-entries',
          build: () => const JournalEntriesScreen(),
          object: false,
        ),
      ];

  for (final screen in screens) {
    testWidgets(
      '${screen.name} list refresh reloads server data and disables while loading',
      (tester) async {
        tester.view.physicalSize = const Size(1700, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final api = _RefreshApi();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(api),
              exportCapabilitiesProvider.overrideWith(
                (ref) async => ExportCapabilities.unknown,
              ),
            ],
            child: MaterialApp(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: Scaffold(body: screen.build()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(api.loads, 1);
        expect(api.path, screen.path);
        expect(find.textContaining('OLD-1'), findsWidgets);

        final refresh = find.byTooltip('Refresh');
        expect(refresh, findsOneWidget);
        await tester.tap(refresh);
        await tester.pump();

        expect(api.loads, 2, reason: 'refresh must fetch from the API');
        final refreshButton = find.ancestor(
          of: refresh,
          matching: find.byType(IconButton),
        );
        expect(
          tester.widget<IconButton>(refreshButton).onPressed,
          isNull,
          reason: 'a second request is disabled while the first is pending',
        );
        expect(find.byType(CircularProgressIndicator), findsOneWidget);

        if (screen.object) {
          api.refreshPage.complete({
            'items': [_row('NEW-2')],
          });
        } else {
          api.refreshRows.complete([_row('NEW-2')]);
        }
        await tester.pumpAndSettle();
        expect(find.textContaining('OLD-1'), findsNothing);
        expect(find.textContaining('NEW-2'), findsWidgets);
        expect(api.loads, 2);
      },
    );
  }
}
