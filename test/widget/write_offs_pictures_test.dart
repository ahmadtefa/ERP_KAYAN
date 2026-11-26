import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/write_offs_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/searchable_select_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Pictures of the write-off form and of the three refusals a person can meet,
/// in Arabic and English. The refusals are what the server's coded 400 turns
/// into on screen: the reviewed sentence, never the server text.
class _Api extends ApiClient {
  _Api({this.failWith})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  final ApiFailure? failWith;
  final posts = <String>[];

  Map<String, dynamic> _doc(String id, String number, {required bool signed}) => {
    'id': id,
    'documentNumber': number,
    'kind': 'write_off',
    'documentDate': '2026-11-05',
    'status': 'draft',
    'reason': 'Broken in transit',
    'notes': null,
    'voucherKind': null,
    'editVersion': 0,
    'counterpartyName': null,
    'reviewedAt': null,
    'reviewedBy': null,
    'fromWarehouseId': 'wh-1',
    'toWarehouseId': null,
    'fromWarehouse': {
      'id': 'wh-1',
      'code': 'MAIN',
      'nameEn': 'Main store',
      'nameAr': 'المخزن الرئيسي',
    },
    'toWarehouse': null,
    // No recorded author: the screen offers the action and the server decides.
    'createdById': null,
    'createdByName': null,
    'postedById': null,
    'postedByName': null,
    'postedAt': null,
    'approvedAt': signed ? '2026-11-04T12:00:00.000Z' : null,
    'approvedById': signed ? 'sara-id' : null,
    'approvedByName': signed ? 'sara' : null,
    'createdAt': '2026-11-05T09:00:00.000Z',
    'lineCount': 1,
    'totalQuantity': '8.0000',
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'wh-1', 'code': 'MAIN', 'nameEn': 'Main store', 'isActive': true},
      ];
    }
    if (path == '/inventory/items') {
      return [
        {'id': 'it-1', 'code': 'P100', 'nameEn': 'Solar panel', 'isActive': true, 'isStockTracked': true},
      ];
    }
    return [_doc('wo-1', 'WO-001', signed: false), _doc('wo-2', 'WO-002', signed: true)];
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add(path);
    if (failWith != null) throw failWith!;
    return const {};
  }
}

final _key = GlobalKey();

Future<void> _fonts(WidgetTester tester) => tester.runAsync(() async {
  await (FontLoader('IBMPlexSansArabic')..addFont(
        Future.value(
          ByteData.sublistView(
            File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync(),
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

Future<void> _shot(WidgetTester tester, String name) async {
  final boundary = _key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await screenshotFile(name).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> _pump(WidgetTester tester, _Api api, bool ar) async {
  tester.view.physicalSize = const Size(1500, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await _fonts(tester);
  await tester.pumpWidget(
    RepaintBoundary(
      key: _key,
      child: ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              permissions: [
                'inventory.stock.read',
                'inventory.writeoff.create',
                'inventory.writeoff.approve',
                'inventory.writeoff.post',
              ],
            ),
          ),
        ],
        child: MaterialApp(
          theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
          locale: Locale(ar ? 'ar' : 'en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: WriteOffsScreen()),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final ar in [false, true]) {
    final tag = ar ? 'ar' : 'en';

    testWidgets('new write-off form picture $tag', (tester) async {
      await _pump(tester, _Api(), ar);
      await tester.tap(find.text(ar ? 'إعدام جديد' : 'New write-off').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(SearchableSelectField));
      await tester.pumpAndSettle();
      await tester.tap(find.text('P100 - Solar panel').last);
      await tester.pumpAndSettle();
      await _shot(tester, 'write-off-form-$tag.png');
      expect(tester.takeException(), isNull);
    });

    final refusals = <List<String>>[
      // [name, action tooltip(en), action tooltip(ar), code, confirm(en), confirm(ar), expected fragment en, ar]
      [
        'self-approval', 'Approve', 'اعتماد', 'WRITE_OFF_SELF_APPROVAL',
        'You cannot approve a write-off you created yourself',
        'لا يمكنك اعتماد مستند إعدام أنشأته أنت',
      ],
      [
        'self-post', 'Post', 'ترحيل', 'WRITE_OFF_SELF_POST',
        'You cannot post a write-off you created yourself',
        'لا يمكنك ترحيل مستند إعدام أنشأته أنت',
      ],
    ];
    for (final r in refusals) {
      testWidgets('refusal picture ${r[0]} $tag', (tester) async {
        final api = _Api(
          failWith: ApiFailure(
            'SERVER_TEXT_THAT_MUST_NOT_SHOW',
            statusCode: 400,
            code: r[3],
          ),
        );
        await _pump(tester, api, ar);
        await tester.tap(find.byTooltip(ar ? r[2] : r[1]).first);
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, ar ? r[2] : r[1]));
        await tester.pumpAndSettle();
        expect(api.posts, hasLength(1));
        expect(find.textContaining(ar ? r[5] : r[4]), findsWidgets);
        expect(find.textContaining('SERVER_TEXT_THAT_MUST_NOT_SHOW'), findsNothing);
        await _shot(tester, 'write-off-${r[0]}-$tag.png');
        expect(tester.takeException(), isNull);
      });
    }
  }
}
