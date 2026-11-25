import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _ItemTaxApi extends ApiClient {
  _ItemTaxApi({required this.existing})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  final bool existing;
  Map<String, dynamic>? submitted;
  bool failFirst = false;
  int posts = 0;
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return [
        {
          'id': 'w',
          'branchId': 'br',
          'code': 'MAIN',
          'nameEn': 'Main warehouse',
          'nameAr': 'المخزن الرئيسي',
          'branchNameEn': 'Cairo branch',
          'branchNameAr': 'فرع القاهرة',
          'isDefault': true,
        },
        // Lower code but not the default: must not be the displayed target.
        {
          'id': 'annex',
          'branchId': 'br',
          'code': 'A0',
          'nameEn': 'Annex warehouse',
          'nameAr': 'مخزن الملحق',
          'branchNameEn': 'Cairo branch',
          'branchNameAr': 'فرع القاهرة',
          'isDefault': false,
        },
      ];
    }
    if (path == '/inventory/locations') {
      return [
        {
          'id': 'shelf',
          'warehouseId': 'w',
          'code': 'A-01',
          'nameEn': 'Shelf A',
          'isActive': true,
        },
        {
          'id': 'bad',
          'warehouseId': 'other',
          'code': 'WRONG',
          'isActive': true,
        },
        {'id': 'off', 'warehouseId': 'w', 'code': 'OFF', 'isActive': false},
      ];
    }
    return existing
        ? [
            {
              'id': 'item',
              'code': 'I-1',
              'nameEn': 'Item',
              'nameAr': 'صنف',
              'unit': 'piece',
              'salePrice': '1',
              'taxRate': '14',
              'isStockTracked': true,
              'isActive': true,
            },
          ]
        : [];
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    submitted = Map<String, dynamic>.from(body! as Map);
    posts++;
    if (failFirst && posts == 1) throw StateError('INTERNAL_DO_NOT_SHOW');
    return {'id': 'item'};
  }

  @override
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    submitted = Map<String, dynamic>.from(body! as Map);
    return {'id': 'item'};
  }
}

void main() {
  for (final ar in [false, true]) {
    testWidgets(
      'item opening shelf is scoped and sent with unchanged quantity and cost ar=$ar',
      (tester) async {
        tester.view.physicalSize = ar
            ? const Size(540, 1000)
            : const Size(1600, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.runAsync(() async {
          await (FontLoader('IBMPlexSansArabic')..addFont(
                Future.value(
                  ByteData.sublistView(
                    File('assets/fonts/IBMPlexSansArabic-Regular.ttf')
                        .readAsBytesSync(),
                  ),
                ),
              ))
              .load();
          await (FontLoader('MaterialIcons')..addFont(
                Future.value(
                  ByteData.sublistView(
                    File(materialIconsFontPath).readAsBytesSync(),
                  ),
                ),
              ))
              .load();
        });
        final api = _ItemTaxApi(existing: false);
        final key = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: ProviderScope(
              overrides: [
                apiClientProvider.overrideWithValue(api),
                currentUserProvider.overrideWithValue(
                  const AppUser(
                    id: 'u',
                    username: 'u',
                    fullName: 'Manager',
                    companyId: 'c',
                    branchId: 'br',
                    permissions: [
                      'inventory.items.create',
                      'inventory.cost.manage',
                    ],
                  ),
                ),
                appConfigProvider.overrideWithValue(
                  AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
                ),
                exportCapabilitiesProvider.overrideWith(
                  (ref) async => ExportCapabilities.unknown,
                ),
              ],
              child: MaterialApp(
                theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
                locale: ar ? const Locale('ar') : const Locale('en'),
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                home: const Scaffold(body: ItemsScreen()),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text(ar ? 'صنف جديد' : 'New item'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, ar ? 'الرمز' : 'Code'),
          'OPEN-1',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Name (English)'),
          'Opening item',
        );
        await tester.tap(find.byType(Switch).first);
        await tester.pumpAndSettle();
        final qty = find.widgetWithText(
          TextFormField,
          ar ? 'الكمية الافتتاحية' : 'Opening quantity',
        );
        await tester.ensureVisible(qty);
        await tester.enterText(qty, '5');
        final cost = find.widgetWithText(
          TextFormField,
          ar ? 'تكلفة الوحدة الافتتاحية' : 'Opening unit cost',
        );
        await tester.ensureVisible(cost);
        await tester.enterText(cost, '2');
        final loc = find.widgetWithText(
          DropdownButtonFormField<String>,
          ar
              ? 'موقع الرصيد الافتتاحي (اختياري)'
              : 'Opening stock location (optional)',
        );
        await tester.ensureVisible(loc);
        // The branch and the target warehouse are named on screen, and the shelf
        // is described as an optional place inside that warehouse.
        expect(
          find.textContaining(
            ar ? 'الفرع: فرع القاهرة' : 'Branch: Cairo branch',
          ),
          findsOneWidget,
        );
        expect(
          find.textContaining(
            ar ? 'المخزن: المخزن الرئيسي' : 'Warehouse: Main warehouse',
          ),
          findsOneWidget,
        );
        expect(find.textContaining(ar ? 'مخزن الملحق' : 'Annex'), findsNothing);
        await tester.tap(loc);
        await tester.pumpAndSettle();
        expect(find.textContaining('WRONG'), findsNothing);
        expect(find.textContaining('OFF'), findsNothing);
        await tester.tap(find.text('A-01 - Shelf A').last);
        await tester.pumpAndSettle();
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await screenshotFile(
            ar ? 'item-opening-shelf-ar.png' : 'item-opening-shelf.png',
          ).writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
        await tester.tap(find.text(ar ? 'حفظ' : 'Save').last);
        await tester.pumpAndSettle();
        expect(
          api.submitted,
          containsPair('openingStorageLocationId', 'shelf'),
        );
        expect(api.submitted, containsPair('openingQuantity', '5'));
        expect(api.submitted, containsPair('openingUnitCost', '2'));
        expect(tester.takeException(), isNull);
      },
    );
  }
}
