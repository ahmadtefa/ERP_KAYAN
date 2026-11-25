import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/item_locations_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/widgets/item_picture.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  final reads = <String>[];
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [
    for (final i in [1, 2])
      {
        'id': 'item-$i',
        'code': 'I-$i',
        'nameEn': i == 1 ? 'Cable' : 'Milk',
        'nameAr': i == 1 ? 'كابل' : 'حليب',
        'unit': 'piece',
        'isActive': true,
      },
  ];
  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) => getObject(path, query: query);
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads.add(path);
    return path.contains('/locations/item/')
        ? {'warehouses': []}
        : path.contains('with-picture')
        ? {'pictures': []}
        : {'mime': null, 'data': null};
  }
}

void main() {
  Future<void> pump(WidgetTester tester, _Api api) async {
    tester.view.physicalSize = const Size(1800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'u',
              companyId: 'c',
              isSuperAdmin: true,
            ),
          ),
          exportCapabilitiesProvider.overrideWith(
            (ref) async => ExportCapabilities.unknown,
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ItemsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'catalogue search trims query filters and clears to original rows',
    (tester) async {
      final api = _Api();
      await pump(tester, api);
      final search = find.byType(TextField);
      await tester.enterText(search, '  milk  ');
      await tester.pumpAndSettle();
      expect(find.text('Milk'), findsOneWidget);
      expect(find.text('Cable'), findsNothing);
      await tester.enterText(search, '');
      await tester.pumpAndSettle();
      expect(find.text('Cable'), findsOneWidget);
      expect(find.text('Milk'), findsOneWidget);
    },
  );
  testWidgets(
    'catalogue picture callback opens selected item editor then returns',
    (tester) async {
      final api = _Api();
      await pump(tester, api);
      await tester.ensureVisible(find.byTooltip('Item picture').first);
      await tester.tap(find.byTooltip('Item picture').first);
      await tester.pumpAndSettle();
      expect(
        tester.widget<ItemPictureEditor>(find.byType(ItemPictureEditor)).itemId,
        'item-1',
      );
      expect(api.reads, contains('/inventory/items/item-1/image'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(ItemsScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('catalogue location callback opens selected item balance route', (
    tester,
  ) async {
    final api = _Api();
    await pump(tester, api);
    await tester.ensureVisible(
      find.byTooltip('Item locations and quantities').last,
    );
    await tester.tap(find.byTooltip('Item locations and quantities').last);
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ItemLocationsScreen>(find.byType(ItemLocationsScreen))
          .itemId,
      'item-2',
    );
    expect(api.reads, contains('/inventory/locations/item/item-2'));
    expect(tester.takeException(), isNull);
  });
}
