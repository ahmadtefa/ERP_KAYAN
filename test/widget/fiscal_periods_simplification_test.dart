import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/fiscal_periods_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart' show apiClientProvider, currentUserProvider;
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show ExportCapabilities, exportCapabilitiesProvider;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _FiscalApi extends ApiClient {
  _FiscalApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [
    {
      'id': 'period',
      'code': '2026',
      'nameEn': 'Year 2026',
      'nameAr': 'سنة 2026',
      'startDate': '2026-01-01',
      'endDate': '2026-12-31',
      'isClosed': false,
      'closedAt': null,
    },
  ];
}

Future<void> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1700, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_FiscalApi()),
        currentUserProvider.overrideWithValue(fullAccessTestUser),
        exportCapabilitiesProvider.overrideWith(
          (ref) async => ExportCapabilities.unknown,
        ),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: FiscalPeriodsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the fiscal-year list shows dates with their year', (
    tester,
  ) async {
    await _pump(tester);

    expect(find.textContaining('January 1, 2026'), findsOneWidget);
    expect(find.textContaining('December 31, 2026'), findsOneWidget);
    // No raw ISO date is left on the screen.
    expect(find.textContaining('2026-01-01'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the fiscal-year form groups its fields under short headings', (
    tester,
  ) async {
    await _pump(tester);

    final edit = find.byTooltip('Edit');
    await tester.ensureVisible(edit);
    await tester.pumpAndSettle();
    await tester.tap(edit);
    await tester.pumpAndSettle();

    expect(find.text('Period details'), findsOneWidget);
    expect(find.text('Dates'), findsOneWidget);
    expect(find.text('The first day of the fiscal year.'), findsOneWidget);
    // The label the existing draft test types into is unchanged.
    expect(find.widgetWithText(TextFormField, 'Name in English'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
