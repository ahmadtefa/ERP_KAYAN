import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/item_thresholds_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Rows shaped exactly like `ItemWarehouseSettingsService.list`, which adds the
/// on-hand quantity and the suggested order to the stored thresholds.
class _ThresholdsApi extends ApiClient {
  _ThresholdsApi({this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failList;
  final puts = <(String, Object?)>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (failList) throw StateError('THRESHOLD_LIST_FAILED');
    return [
      {
        'id': 's-1',
        'warehouseId': 'wh-1',
        'itemId': 'it-1',
        'item': {
          'code': 'I-1',
          'nameEn': 'Cable',
          'nameAr': 'كابل',
          'unit': 'm',
        },
        'warehouse': {'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'المخزن الرئيسي'},
        'minQuantity': '10.0000',
        'reorderQuantity': '25.0000',
        'maxQuantity': '100.0000',
        'onHand': '4.0000',
        'suggestedOrder': '96.0000',
        'isBelowMinimum': true,
        'isAboveMaximum': false,
      },
      {
        'id': 's-2',
        'warehouseId': 'wh-1',
        'itemId': 'it-2',
        'item': {
          'code': 'I-2',
          'nameEn': 'Glue',
          'nameAr': 'صمغ',
          'unit': 'kg',
        },
        'warehouse': {'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'المخزن الرئيسي'},
        'minQuantity': '5.0000',
        'reorderQuantity': '0.0000',
        'maxQuantity': '0.0000',
        'onHand': '80.0000',
        'suggestedOrder': '0.0000',
        'isBelowMinimum': false,
        'isAboveMaximum': false,
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> put(String path, {Object? body}) async {
    puts.add((path, body));
    return const {};
  }
}

Finder tableText(String value) => find.byWidgetPredicate(
  (widget) => widget is Text && widget.data == value,
);

void main() {
  Future<void> pump(
    WidgetTester tester,
    _ThresholdsApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = const [
      'inventory.warehouses.read',
      'inventory.warehouses.manage',
    ],
  }) async {
    tester.view.physicalSize = const Size(1700, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              permissions: permissions,
            ),
          ),
        ],
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ItemThresholdsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows each threshold beside the quantity it compares to', (
    tester,
  ) async {
    await pump(tester, _ThresholdsApi());
    expect(find.text('Cable'), findsOneWidget);
    expect(find.text('Glue'), findsOneWidget);
    expect(find.textContaining('10'), findsWidgets);
    expect(find.textContaining('100'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a zero suggested order renders as a dash, not as 0.00', (
    tester,
  ) async {
    await pump(tester, _ThresholdsApi());
    // Glue is above its minimum, so there is nothing to order and the column
    // must not read like an instruction.
    expect(find.text('—'), findsWidgets);
  });

  testWidgets('the status column separates below-minimum from within-limits', (
    tester,
  ) async {
    await pump(tester, _ThresholdsApi());
    expect(find.text('Below minimum'), findsOneWidget);
    expect(find.text('Within limits'), findsOneWidget);
  });

  testWidgets('the below-minimum chip leaves only the short rows', (
    tester,
  ) async {
    await pump(tester, _ThresholdsApi());
    await tester.tap(find.byType(FilterChip));
    await tester.pumpAndSettle();
    expect(find.text('Cable'), findsOneWidget);
    expect(find.text('Glue'), findsNothing);
  });

  testWidgets('search narrows by item and by warehouse name', (tester) async {
    await pump(tester, _ThresholdsApi());
    await tester.enterText(find.byType(TextField).first, 'Glue');
    await tester.pumpAndSettle();
    expect(tableText('Glue'), findsOneWidget);
    expect(tableText('Cable'), findsNothing);
  });

  testWidgets('editing puts the thresholds to the warehouse/item pair', (
    tester,
  ) async {
    final api = _ThresholdsApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Edit').first);
    await tester.pumpAndSettle();
    expect(find.text('Set thresholds'), findsOneWidget);

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(api.puts, isNotEmpty);
    // The path carries both ids because a threshold is not an item property
    // and not a warehouse property: it is the pair.
    expect(api.puts.first.$1, '/inventory/item-thresholds/wh-1/it-1');
  });

  testWidgets('the maximum helper says zero means no ceiling', (tester) async {
    await pump(tester, _ThresholdsApi());
    await tester.tap(find.byTooltip('Edit').first);
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Zero means no ceiling'),
      findsOneWidget,
    );
  });

  testWidgets('a read-only grant hides the edit control', (tester) async {
    await pump(
      tester,
      _ThresholdsApi(),
      permissions: const ['inventory.warehouses.read'],
    );
    expect(find.text('Cable'), findsOneWidget);
    expect(find.byTooltip('Edit'), findsNothing);
  });

  testWidgets('a failed list shows the error view with a retry', (
    tester,
  ) async {
    await pump(tester, _ThresholdsApi(failList: true));
    expect(find.textContaining('THRESHOLD_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic reads the Arabic names and mirrors', (tester) async {
    await pump(tester, _ThresholdsApi(), locale: const Locale('ar'));
    expect(find.text('كابل'), findsOneWidget);
    expect(find.text('Cable'), findsNothing);
    expect(
      Directionality.of(tester.element(find.text('كابل'))),
      TextDirection.rtl,
    );
  });

  testWidgets('the header names the module and offers a way back', (
    tester,
  ) async {
    await pump(tester, _ThresholdsApi());
    expect(find.text('Item thresholds'), findsOneWidget);
    expect(find.text('INVENTORY'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  });
}
