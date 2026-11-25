import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
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
  Object? failWith;
  int posts = 0;
  Map<String, dynamic> target = {
    'state': 'ready',
    'branch': {'nameEn': 'Cairo branch', 'nameAr': 'فرع القاهرة'},
    'warehouse': {
      'id': 'w',
      'code': 'MAIN',
      'nameEn': 'Main warehouse',
      'nameAr': 'المخزن الرئيسي',
    },
  };
  bool targetFails = false;
  int targetCalls = 0;
  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/items/opening-target') {
      targetCalls++;
      if (targetFails) throw StateError('boom');
      return target;
    }
    return {};
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'w', 'branchId': 'br', 'code': 'MAIN', 'isDefault': true},
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
    if (failWith != null) throw failWith!;
    if (failFirst && posts == 1) throw StateError('INTERNAL_DO_NOT_SHOW');
    return {'id': 'item'};
  }

  @override
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    submitted = Map<String, dynamic>.from(body! as Map);
    return {'id': 'item'};
  }
}

Future<void> _fonts(WidgetTester tester) => tester.runAsync(() async {
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
          ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync()),
        ),
      ))
      .load();
});

final _shotKey = GlobalKey();
Future<void> _shot(WidgetTester tester, GlobalKey key, String name) async {
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await screenshotFile(name).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  // [name, branchId, serverMessage, expectedArabicFragment]
  final cases = <List<String?>>[
    [
      'no-branch',
      null,
      'Select a branch before adding opening stock',
      'اختر الفرع',
    ],
    [
      'branch-has-opening',
      'br',
      'This branch already has an opening balance (OB-0001). Add the item there instead of giving it opening stock here.',
      'مستند رصيد افتتاحي',
    ],
    [
      'missing-account',
      'br',
      "Required account 01010301 (inventory) does not exist in this company's chart of accounts",
      'دليل الحسابات',
    ],
    [
      'name-missing',
      'br',
      'Provide an Arabic or English item name',
      'اسم الصنف',
    ],
  ];
  for (final c in cases) {
    testWidgets('new item shows a specific Arabic message: ${c[0]}', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(900, 1300);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await _fonts(tester);
      final api = _ItemTaxApi(existing: false)
        ..failWith = ApiFailure(c[2]!, statusCode: 400);
      final key = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: key,
          child: ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(api),
              currentUserProvider.overrideWithValue(
                AppUser(
                  id: 'u',
                  username: 'u',
                  fullName: 'Manager',
                  companyId: 'c',
                  branchId: c[1],
                  permissions: const [
                    'inventory.items.create',
                    'inventory.cost.manage',
                    'inventory.items.purchaseprice.manage',
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
              locale: const Locale('ar'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const Scaffold(body: ItemsScreen()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('صنف جديد'));
      await tester.pumpAndSettle();
      Future<void> fill(String label, String v) async {
        final f = find.widgetWithText(TextFormField, label);
        await tester.ensureVisible(f);
        await tester.enterText(f, v);
      }

      await fill('الرمز', 'TE-01');
      await fill('Name (English)', 'Arosa Tea');
      await fill('الاسم (عربي)', 'شاي العروسة');
      await fill('الوحدة', 'باكو');
      await fill('سعر الشراء', '20');
      await tester.tap(find.byType(Switch).first);
      await tester.pumpAndSettle();
      await fill('الكمية الافتتاحية', '1000');
      await fill('تكلفة الوحدة الافتتاحية', '20');
      await tester.tap(find.text('حفظ').last);
      await tester.pumpAndSettle();
      // Payload evidence: which keys the form sent, and the location key.
      final sent = api.submitted!;
      // ignore: avoid_print
      print(
        'PAYLOAD ${c[0]} keys=${(sent.keys.toList()..sort())} '
        'hasLocationKey=${sent.containsKey('openingStorageLocationId')} '
        'hasLocationDropdown=${find.byType(DropdownButtonFormField<String>).evaluate().isNotEmpty} '
        'values=${{
          for (final k in ['code', 'nameEn', 'nameAr', 'unit', 'purchasePrice', 'taxRate', 'isStockTracked', 'openingQuantity', 'openingUnitCost']) k: sent[k],
        }}',
      );
      expect(sent.containsKey('openingStorageLocationId'), isFalse);
      expect(find.textContaining(c[3]!), findsWidgets);
      expect(find.textContaining('البيانات المرسلة غير صالحة'), findsNothing);
      // The typed values stay in the form behind the dialog.
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await screenshotFile('item-new-error-${c[0]}.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.tap(find.text('حسنًا'));
      await tester.pumpAndSettle();
      expect(find.textContaining('قد تكون العملية قد اكتملت'), findsNothing);
      final save = find.ancestor(
        of: find.text('حفظ').last,
        matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
      );
      expect((tester.widget(save) as ButtonStyleButton).onPressed, isNotNull);
      expect(find.text('TE-01'), findsOneWidget);
      await _shot(tester, key, 'item-new-error-${c[0]}-after-dismiss.png');
      // Retry with the same values reaches the server again.
      api.failWith = null;
      await tester.tap(find.text('حفظ').last);
      await tester.pumpAndSettle();
      expect(api.posts, 2);
      expect(tester.takeException(), isNull);
    });
  }

  // ---- retry / duplicate-protection behaviour ----
  Future<void> openAndFill(WidgetTester tester, _ItemTaxApi api) async {
    tester.view.physicalSize = const Size(900, 1300);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await _fonts(tester);
    await tester.pumpWidget(
      RepaintBoundary(
        key: _shotKey,
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
                  'inventory.items.purchaseprice.manage',
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
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: ItemsScreen()),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('صنف جديد'));
    await tester.pumpAndSettle();
    Future<void> fill(String label, String v) async {
      final f = find.widgetWithText(TextFormField, label);
      await tester.ensureVisible(f);
      await tester.enterText(f, v);
    }

    await fill('الرمز', 'TE-01');
    await fill('Name (English)', 'Arosa Tea');
    await fill('الاسم (عربي)', 'شاي العروسة');
    await fill('الوحدة', 'باكو');
    await fill('سعر الشراء', '20');
    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();
    await fill('الكمية الافتتاحية', '1000');
    await fill('تكلفة الوحدة الافتتاحية', '20');
  }

  Finder saveButton() => find.ancestor(
    of: find.text('حفظ').last,
    matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
  );
  const banner = 'قد تكون العملية قد اكتملت';

  testWidgets('known refusal: no banner, form editable, same values retried', (
    tester,
  ) async {
    final api = _ItemTaxApi(existing: false)
      ..failWith = const ApiFailure(
        'Select a branch before adding opening stock',
        statusCode: 400,
      );
    await openAndFill(tester, api);
    await tester.tap(find.text('حفظ').last);
    await tester.pumpAndSettle();
    expect(find.textContaining('اختر الفرع'), findsWidgets);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.textContaining(banner), findsNothing);
    expect(
      (tester.widget(saveButton()) as ButtonStyleButton).onPressed,
      isNotNull,
    );
    expect(find.text('TE-01'), findsOneWidget);
    expect(find.text('1000'), findsOneWidget);
    api.failWith = null;
    await tester.tap(find.text('حفظ').last);
    await tester.pumpAndSettle();
    expect(api.posts, 2);
    expect(api.submitted, containsPair('openingQuantity', '1000'));
    expect(api.submitted, containsPair('code', 'TE-01'));
    expect(
      find.text('صنف جديد'),
      findsOneWidget,
    ); // list button only; form closed
  });

  final ambiguous = <String, Object>{
    'unknown 400': const ApiFailure('Bad request', statusCode: 400),
    'known sentence on a 500': const ApiFailure(
      'Select a branch before adding opening stock',
      statusCode: 500,
    ),
    'known sentence on a 503': const ApiFailure(
      'Select a branch before adding opening stock',
      statusCode: 503,
    ),
    'rolled-back-after-timeout 503': const ApiFailure(
      'The operation took too long and was rolled back. Reload the document to check its state before trying again.',
      statusCode: 503,
      code: 'TRANSACTION_ROLLED_BACK',
    ),
    'server error 500': const ApiFailure(
      'Unexpected server error',
      statusCode: 500,
    ),
    'network': const NetworkFailure(),
    'untyped error with a known sentence':
        'Select a branch before adding opening stock',
  };
  for (final e in ambiguous.entries) {
    testWidgets('ambiguous keeps the lock: ${e.key}', (tester) async {
      final api = _ItemTaxApi(
        existing: false,
      )..failWith = e.value is String ? StateError(e.value as String) : e.value;
      await openAndFill(tester, api);
      await tester.tap(find.text('حفظ').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('حسنًا'));
      await tester.pumpAndSettle();
      expect(find.textContaining(banner), findsOneWidget);
      expect(
        (tester.widget(saveButton()) as ButtonStyleButton).onPressed,
        isNull,
      );
      await _shot(
        tester,
        _shotKey,
        'item-ambiguous-${e.key.replaceAll(' ', '-')}-after-dismiss.png',
      );
      await tester.tap(find.text('حفظ').last, warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(api.posts, 1); // no duplicate create possible
    });
  }
}
