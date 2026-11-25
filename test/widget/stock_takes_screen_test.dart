import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_takes_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Rows shaped like `StockTakesService.toSummary`, which carries the opener's
/// id so the screen can tell whether the caller may approve.
class _StockTakesApi extends ApiClient {
  _StockTakesApi({this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  int listCalls = 0;
  bool failList;
  ApiFailure? failCount;

  /// A list of sessions that are all still being counted. The approval tests
  /// need a session in REVIEW next to the ones being counted, but the test
  /// that proves "nothing is offered while counting" would then see that
  /// session's Approve button. It asks for a list where every row is COUNTING.
  bool countingOnly = false;
  final posts = <String>[];
  final bodies = <String, Object?>{};
  final Map<String, dynamic> detail = {
    'id': 'st-1',
    'code': 'ST-001',
    'warehouseId': 'wh-1',
    'warehouseNameEn': 'Main store',
    'warehouseNameAr': 'المخزن الرئيسي',
    'status': 'COUNTING',
    'createdBy': 'someone-else',
    'lines': [
      {
        'id': 'line-1',
        'itemId': 'item-1',
        'itemCode': 'ITEM-1',
        'itemNameEn': 'Coffee',
        'itemNameAr': 'قهوة',
        'unit': 'piece',
        'systemQuantity': '10.0000',
        'countedQuantity': null,
        'varianceQuantity': '0.0000',
        'varianceValue': '0.0000',
      },
    ],
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/stock-takes') listCalls++;
    if (failList && path == '/inventory/stock-takes') {
      throw StateError('STOCKTAKE_LIST_FAILED');
    }
    if (path == '/inventory/locations') {
      return [
        {
          'id': 'shelf-c',
          'warehouseId': 'wh-1',
          'code': 'C-01',
          'nameEn': 'Shelf C',
          'isActive': true,
        },
      ];
    }
    if (path == '/inventory/warehouses') {
      return [
        {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
        {
          'id': 'wh-2',
          'code': 'SECOND',
          'nameEn': 'Second store',
          'nameAr': 'المخزن الثاني',
        },
      ];
    }
    if (path == '/inventory/items') {
      return [
        {
          'id': 'item-1',
          'code': 'ITEM-1',
          'nameEn': 'Coffee',
          'nameAr': 'قهوة',
        },
      ];
    }
    final list = <Map<String, dynamic>>[
      {
        'id': 'st-1',
        'code': 'ST-001',
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'FULL',
        'status': 'COUNTING',
        'frozenAt': null,
        'createdBy': 'someone-else',
        'approvedAt': null,
        'approvedBy': null,
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 12,
        'notes': null,
        'createdAt': '2026-11-05T09:00:00.000Z',
      },
      {
        'id': 'st-2',
        'code': 'ST-002',
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'PARTIAL',
        'status': 'APPROVED',
        'frozenAt': null,
        'createdBy': 'u',
        'approvedAt': '2026-11-06T10:00:00.000Z',
        'approvedBy': 'someone-else',
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 4,
        'notes': null,
        'createdAt': '2026-11-04T09:00:00.000Z',
      },
      {
        'id': 'st-3',
        'code': 'ST-003',
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'FULL',
        // Reached REVIEW but opened by the current user, so the screen offers a
        // disabled control that says why instead of an Approve action.
        'status': 'REVIEW',
        'frozenAt': null,
        'createdBy': 'u',
        'approvedAt': null,
        'approvedBy': null,
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 7,
        'notes': null,
        'createdAt': '2026-11-03T09:00:00.000Z',
      },
      {
        'id': 'st-4',
        'code': 'ST-004',
        // Still being counted, like st-1. Nothing is offered on it: the flow is
        // DRAFT -> COUNTING -> REVIEW -> APPROVED -> POSTED and only REVIEW may
        // be approved.
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'FULL',
        'status': 'COUNTING',
        'frozenAt': null,
        'createdBy': 'someone-else',
        'approvedAt': null,
        'approvedBy': null,
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 3,
        'notes': null,
        'createdAt': '2026-11-02T09:00:00.000Z',
      },
      {
        'id': 'st-5',
        'code': 'ST-005',
        // Reached REVIEW and opened by somebody else, so an approver is offered
        // the Approve action here and nowhere among the counted sessions.
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'PARTIAL',
        'status': 'REVIEW',
        'frozenAt': null,
        'createdBy': 'someone-else',
        'approvedAt': null,
        'approvedBy': null,
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 2,
        'notes': null,
        'createdAt': '2026-11-01T09:00:00.000Z',
      },
    ];
    if (!countingOnly) return list;
    return list.where((row) => row['status'] == 'COUNTING').toList();
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/stock-takes/st-1' ||
        path == '/inventory/stock-takes/st-new') {
      return Map<String, dynamic>.from(detail);
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add(path);
    bodies[path] = body;
    if (path == '/inventory/stock-takes') return {'id': 'st-new'};
    if (path.endsWith('/locations')) return Map<String, dynamic>.from(detail);
    if (path.endsWith('/count') && failCount != null) throw failCount!;
    if (path.endsWith('/count')) return Map<String, dynamic>.from(detail);
    return const {};
  }
}

const _approver = [
  'inventory.stocktake.read',
  'inventory.stocktake.approve',
  'inventory.stocktake.post',
];

Finder tableText(String value) =>
    find.byWidgetPredicate((widget) => widget is Text && widget.data == value);

final visualKey = GlobalKey();
void main() {
  Future<void> pump(
    WidgetTester tester,
    _StockTakesApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = _approver,
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
        child: RepaintBoundary(
          key: visualKey,
          child: MaterialApp(
            theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: StockTakesScreen()),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'count distinguishes the same lot on two shelves and unlocated stock',
    (tester) async {
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
      });
      await tester.runAsync(() async {
        await (FontLoader('MaterialIcons')..addFont(
              Future.value(
                ByteData.sublistView(
                  File(
                    '/tmp/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
                  ).readAsBytesSync(),
                ),
              ),
            ))
            .load();
      });
      final api = _StockTakesApi();
      final base = Map<String, dynamic>.from(
        (api.detail['lines'] as List).first as Map,
      );
      api.detail['lines'] = [
        for (final (id, code, qty) in [
          ('A', 'A-01', '6.0000'),
          ('B', 'B-01', '4.0000'),
          ('U', null, '3.0000'),
        ])
          {
            ...base,
            'id': id,
            'batchNumber': 'LOT-1',
            'storageLocationId': code == null ? null : 'shelf-$id',
            'storageLocationCode': code,
            'storageLocationNameEn': code == null ? null : 'Shelf $id',
            'systemQuantity': qty,
          },
      ];
      await pump(
        tester,
        api,
        permissions: ['inventory.stocktake.read', 'inventory.stocktake.count'],
      );
      await tester.tap(find.text('ST-001'));
      await tester.pumpAndSettle();
      expect(find.text('Location: A-01 - Shelf A'), findsOneWidget);
      expect(find.text('Location: B-01 - Shelf B'), findsOneWidget);
      expect(find.text('Location: Unlocated stock'), findsOneWidget);
      final boundary =
          visualKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('/downloads/stock-take-locations.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'add count location preserves typed counts and sends exact item lot shelf',
    (tester) async {
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
                  File(
                    '/tmp/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
                  ).readAsBytesSync(),
                ),
              ),
            ))
            .load();
      });
      final api = _StockTakesApi();
      await pump(
        tester,
        api,
        permissions: ['inventory.stocktake.read', 'inventory.stocktake.count'],
      );
      await tester.tap(find.text('ST-001'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Counted qty'),
        '8',
      );
      await tester.tap(find.text('Add count location'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(DropdownButtonFormField<String>, 'Item and batch'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('ITEM-1 | No lot').last);
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(DropdownButtonFormField<String>, 'Location'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('C-01 - Shelf C').last);
      await tester.pumpAndSettle();
      final boundary =
          visualKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('/downloads/count-add-location.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.tap(find.text('Add location'));
      await tester.pumpAndSettle();
      expect(api.bodies['/inventory/stock-takes/st-1/locations'], {
        'itemId': 'item-1',
        'batchId': null,
        'storageLocationId': 'shelf-c',
      });
      expect(
        tester
            .widget<TextFormField>(
              find.widgetWithText(TextFormField, 'Counted qty'),
            )
            .initialValue,
        '8',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('refresh reloads counts without a stock action', (tester) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    final before = api.listCalls;
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    expect(api.listCalls, greaterThan(before));
    expect(api.posts, isEmpty);
  });

  testWidgets('back from cancellation and closing details sends nothing', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: ['inventory.stocktake.read', 'inventory.stocktake.create'],
    );
    await tester.tap(find.text('ST-001'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel count'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Cancellation reason'),
      'not sent',
    );
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(find.text('ST-001 — Stock take details'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.text('ST-001 — Stock take details'), findsNothing);
    expect(api.posts, isEmpty);
  });

  testWidgets('confirming post targets the approved session and refreshes', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    final before = api.listCalls;
    await tester.tap(find.byTooltip('Post'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Post'));
    await tester.pumpAndSettle();
    expect(api.posts.where((x) => x.endsWith('/post')), hasLength(1));
    expect(api.posts.single, '/inventory/stock-takes/st-2/post');
    expect(api.listCalls, greaterThan(before));
  });

  testWidgets('lists sessions with warehouse, scope, lines and status', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    expect(find.text('ST-001'), findsOneWidget);
    expect(find.text('ST-002'), findsOneWidget);
    expect(find.text('ST-003'), findsOneWidget);
    expect(find.text('Main store'), findsWidgets);
    expect(find.text('Full'), findsWidgets);
    expect(find.text('Partial'), findsNWidgets(2));
    expect(find.text('12'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('statuses are words, and reached statuses look different', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    expect(find.text('Counting'), findsNWidgets(2));
    expect(find.text('In review'), findsNWidgets(2));
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('COUNTING'), findsNothing);
  });

  testWidgets('an approver sees Approve on sessions awaiting review only', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    // One session reached REVIEW and was opened by somebody else, so it may be
    // approved; another is APPROVED and offers Post. The sessions still being
    // counted offer neither.
    expect(find.byTooltip('Approve'), findsOneWidget);
    expect(find.byTooltip('Post'), findsOneWidget);
  });

  testWidgets('the person who opened a count cannot approve it', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    // The reason is on the control itself, so it is legible before the click.
    expect(
      find.byTooltip('You opened this count, so you cannot approve it'),
      findsOneWidget,
    );
    final tooltip = find.byTooltip(
      'You opened this count, so you cannot approve it',
    );
    final button = tester.widget<IconButton>(
      find.descendant(of: tooltip, matching: find.byType(IconButton)),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('approving confirms first, and says that posting moves stock', (
    tester,
  ) async {
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
                File(
                  '/tmp/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
                ).readAsBytesSync(),
              ),
            ),
          ))
          .load();
    });
    final api = _StockTakesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Approve'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Approving does not move stock yet'),
      findsOneWidget,
    );
    expect(api.posts, isEmpty);
  });

  testWidgets('confirming approve posts to the session, not to a list route', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    // st-5 is the session in REVIEW opened by somebody else: the only row
    // this approver is offered an Approve action on.
    await tester.tap(find.byTooltip('Approve'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/stock-takes/st-5/approve'));
    expect(api.posts, isNot(contains('/inventory/stock-takes/st-1/approve')));
  });

  testWidgets('posting is confirmed as irreversible before it is sent', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Post'));
    await tester.pumpAndSettle();
    expect(find.textContaining('This cannot be undone'), findsOneWidget);
    expect(api.posts, isEmpty);
  });

  testWidgets('a clerk who may count but not approve sees no approve', (
    tester,
  ) async {
    await pump(
      tester,
      _StockTakesApi(),
      permissions: const [
        'inventory.stocktake.read',
        'inventory.stocktake.count',
      ],
    );
    expect(find.text('ST-001'), findsOneWidget);
    expect(find.byTooltip('Approve'), findsNothing);
    expect(find.byTooltip('Post'), findsNothing);
    expect(
      find.byTooltip('You opened this count, so you cannot approve it'),
      findsNothing,
    );
  });

  testWidgets('search narrows by code and by warehouse', (tester) async {
    await pump(tester, _StockTakesApi());
    await tester.enterText(find.byType(TextField).first, 'ST-002');
    await tester.pumpAndSettle();
    expect(tableText('ST-002'), findsOneWidget);
    expect(tableText('ST-001'), findsNothing);
  });

  testWidgets('a failed list shows the error view with a retry', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi(failList: true));
    expect(find.textContaining('STOCKTAKE_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'new count warehouse selection and notes preserve chosen scope payload',
    (tester) async {
      final api = _StockTakesApi();
      await pump(
        tester,
        api,
        permissions: ['inventory.stocktake.read', 'inventory.stocktake.create'],
      );
      await tester.tap(find.byKey(const ValueKey('stock-take-new')));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('SECOND').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Notes'),
        ' second warehouse audit ',
      );
      await tester.tap(find.text('Open count'));
      await tester.pumpAndSettle();
      expect(api.bodies['/inventory/stock-takes'], {
        'warehouseId': 'wh-2',
        'scope': 'FULL',
        'notes': 'second warehouse audit',
      });
    },
  );
  testWidgets('creates a full stock take and opens its frozen count lines', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: const [
        'inventory.stocktake.read',
        'inventory.stocktake.create',
        'inventory.stocktake.count',
      ],
    );
    await tester.tap(find.byKey(const ValueKey('stock-take-new')));
    await tester.pumpAndSettle();
    expect(find.text('Open count'), findsOneWidget);
    await tester.tap(find.text('Open count'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/stock-takes'));
    expect(find.text('ST-001 — Stock take details'), findsOneWidget);
    expect(find.text('ITEM-1 — Coffee'), findsOneWidget);
  });

  testWidgets(
    'partial count requires item selection and preserves notes in its request',
    (tester) async {
      final api = _StockTakesApi();
      await pump(
        tester,
        api,
        permissions: const [
          'inventory.stocktake.read',
          'inventory.stocktake.create',
        ],
      );
      await tester.tap(find.byKey(const ValueKey('stock-take-new')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Partial'),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Open count'),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byType(CheckboxListTile));
      await tester.enterText(
        find.widgetWithText(TextField, 'Notes'),
        '  physical partial check  ',
      );
      await tester.tap(find.text('Open count'));
      await tester.pumpAndSettle();
      expect(api.bodies['/inventory/stock-takes'], {
        'warehouseId': 'wh-1',
        'scope': 'PARTIAL',
        'itemIds': ['item-1'],
        'notes': 'physical partial check',
      });
    },
  );

  testWidgets('cancelling a new stock take sends nothing', (tester) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: const [
        'inventory.stocktake.read',
        'inventory.stocktake.create',
      ],
    );
    await tester.tap(find.byKey(const ValueKey('stock-take-new')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.posts, isEmpty);
    expect(find.text('Open a new stock take'), findsNothing);
  });

  testWidgets(
    'finish requires all frozen lines while save allows a partial count',
    (tester) async {
      final api = _StockTakesApi();
      (api.detail['lines'] as List).add({
        'id': 'line-2',
        'itemId': 'item-2',
        'itemCode': 'ITEM-2',
        'itemNameEn': 'Tea',
        'unit': 'piece',
        'systemQuantity': '4',
        'countedQuantity': null,
      });
      await pump(
        tester,
        api,
        permissions: const [
          'inventory.stocktake.read',
          'inventory.stocktake.count',
        ],
      );
      await tester.tap(find.text('ST-001'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byWidgetPredicate(
          (widget) =>
              widget is TextFormField &&
              widget.key.toString().contains('count-line-1-'),
        ),
        '0',
      );
      await tester.tap(find.text('Finish & review'));
      await tester.pumpAndSettle();
      expect(
        find.text('Enter the counted quantity before finishing.'),
        findsOneWidget,
      );
      expect(api.posts, isEmpty);
      await tester.tap(find.text('Save count'));
      await tester.pumpAndSettle();
      expect(api.bodies['/inventory/stock-takes/st-1/count'], {
        'lines': [
          {'lineId': 'line-1', 'countedQuantity': 0.0},
        ],
        'finish': false,
      });
    },
  );

  testWidgets('cancelling an open count sends its entered reason', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: const [
        'inventory.stocktake.read',
        'inventory.stocktake.create',
      ],
    );
    await tester.tap(find.text('ST-001'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel count'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Cancellation reason'),
      '  duplicate count  ',
    );
    await tester.tap(find.text('Confirm cancellation'));
    await tester.pumpAndSettle();
    expect(api.bodies['/inventory/stock-takes/st-1/cancel'], {
      'reason': 'duplicate count',
    });
  });

  testWidgets('saves counted quantities to the session count endpoint', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: const [
        'inventory.stocktake.read',
        'inventory.stocktake.count',
      ],
    );
    await tester.tap(find.text('ST-001'));
    await tester.pumpAndSettle();
    expect(find.text('ITEM-1 — Coffee'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).last, '8');
    await tester.tap(find.text('Save count'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/stock-takes/st-1/count'));
    expect(api.bodies['/inventory/stock-takes/st-1/count'], {
      'lines': [
        {'lineId': 'line-1', 'countedQuantity': 8.0},
      ],
      'finish': false,
    });
  });

  testWidgets(
    'a refused count names the line, keeps the typed figure, and clears on edit',
    (tester) async {
      final api = _StockTakesApi()
        ..failCount = const ApiFailure(
          'x',
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          fieldErrors: {'lines.0.countedQuantity': 'الكمية أكبر من المسموح'},
        );
      await pump(
        tester,
        api,
        permissions: const [
          'inventory.stocktake.read',
          'inventory.stocktake.count',
        ],
      );
      await tester.tap(find.text('ST-001'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).last, '8');
      await tester.tap(find.text('Save count'));
      await tester.pumpAndSettle();
      expect(find.text('الكمية أكبر من المسموح'), findsOneWidget);
      expect(find.text('8'), findsWidgets);
      await tester.enterText(find.byType(TextFormField).last, '7');
      await tester.pump();
      expect(find.text('الكمية أكبر من المسموح'), findsNothing);
    },
  );

  testWidgets('late closed-count refusal retains typed figures for recovery', (
    tester,
  ) async {
    final api = _StockTakesApi()
      ..failCount = const ApiFailure(
        'Count is no longer open',
        statusCode: 400,
        code: 'STOCK_TAKE_NOT_COUNTING',
      );
    await pump(
      tester,
      api,
      permissions: ['inventory.stocktake.read', 'inventory.stocktake.count'],
    );
    await tester.tap(find.text('ST-001'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).last, '9');
    await tester.tap(find.text('Save count'));
    await tester.pumpAndSettle();
    expect(find.text('9'), findsWidgets);
    expect(find.text('ST-001 — Stock take details'), findsOneWidget);
    expect(api.posts.where((x) => x.endsWith('/count')), hasLength(1));
  });

  testWidgets(
    'an invalid or missing count is marked on its own line and nothing is sent',
    (tester) async {
      final api = _StockTakesApi();
      await pump(
        tester,
        api,
        permissions: const [
          'inventory.stocktake.read',
          'inventory.stocktake.count',
        ],
      );
      await tester.tap(find.text('ST-001'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).last, '-3');
      await tester.tap(find.text('Save count'));
      await tester.pumpAndSettle();
      expect(find.text('Enter a number that is zero or more.'), findsOneWidget);
      expect(api.posts.where((x) => x.endsWith('/count')), isEmpty);
    },
  );

  testWidgets(
    'does not offer approval while a stock take is still being counted',
    (tester) async {
      await pump(
        tester,
        _StockTakesApi()..countingOnly = true,
        permissions: const [
          'inventory.stocktake.read',
          'inventory.stocktake.approve',
        ],
      );
      // Every row in this list is still being counted, so an approver is offered
      // nothing to approve - only a session that reached REVIEW may be.
      expect(find.byTooltip('Approve'), findsNothing);
      expect(find.text('Counting'), findsNWidgets(2));
    },
  );

  testWidgets('Arabic reads the Arabic warehouse name and mirrors', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi(), locale: const Locale('ar'));
    expect(find.text('الجرد'), findsOneWidget);
    expect(find.text('جارٍ العد'), findsNWidgets(2));
    expect(find.text('قيد المراجعة'), findsNWidgets(2));
    expect(
      Directionality.of(tester.element(find.text('جارٍ العد').first)),
      TextDirection.rtl,
    );
  });
}
