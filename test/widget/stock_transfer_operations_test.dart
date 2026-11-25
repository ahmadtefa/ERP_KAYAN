import 'package:shared_preferences/shared_preferences.dart';

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';

import 'package:flutter/rendering.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_transfers_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api(this.status)
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  final String status;
  final posts = <(String, Object?)>[];
  final keys = <String?>[];
  int reads = 0;
  bool refuse = false;
  bool definite = false;
  bool confirmed = false;
  String proofState = 'COMPLETED';
  String proofAction = 'DISPATCH';
  bool wrongProofKey = false;
  bool failReport = false;
  Map<String, dynamic> get row => {
    'id': 't',
    'documentNumber': 'TR-OPS',
    'status': status,
    'reason': 'Synthetic',
    'transferDate': '2026-11-25',
    'sourceWarehouse': {'nameEn': 'Main'},
    'destinationWarehouse': {'nameEn': 'Target'},
    'lines': [
      {
        'id': 'line',
        'item': {'nameEn': 'Cable'},
        'requestedQuantity': '10',
        'dispatchedQuantity': '6',
        'receivedQuantity': '2',
        'returnedQuantity': '1',
        'writtenOffQuantity': '1',
        'reportedShortage': '0',
        'reportedDamage': '0',
      },
    ],
  };
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [row];
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads++;
    if (path.endsWith('/report')) {
      if (failReport) throw StateError('PRIVATE_REPORT_DIAGNOSTIC');
      return {
        'rows': List.generate(
          45,
          (i) => {
            'documentNumber': 'REPORT-$i',
            'status': 'PARTIALLY_RECEIVED',
            'dispatched': '10',
            'received': '3',
            'inTransit': '7',
            'differences': '0',
          },
        ),
      };
    }
    if (path.endsWith('/actions')) {
      return {
        'transferId': 't',
        'key': wrongProofKey ? 'wrong' : query?['key'],
        'state': confirmed ? proofState : 'ABSENT',
        'outcomes': confirmed
            ? [
                {
                  'action': proofAction,
                  'requestKey': '$proofAction:${query?['key']}',
                  'state': proofState,
                  'scope': 'DECISION_ONLY',
                  'operationComplete': true,
                  'terminalPending': null,
                  'applied': proofState == 'ALREADY_APPROVED' ? false : true,
                },
              ]
            : [],
      };
    }
    return path.endsWith('/approvals')
        ? {}
        : {
            ...row,
            'actions': confirmed && keys.isNotEmpty
                ? [
                    {
                      'requestKey': 'DISPATCH:${keys.last}',
                      'stockDocumentId': 'confirmed-doc',
                    },
                  ]
                : [],
          };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add((path, body));
    keys.add(idempotencyKey);
    if (definite) {
      throw const ApiFailure(
        "Source quantity changed. Reduce the amount.",
        statusCode: 400,
      );
    }
    if (refuse) throw StateError("PRIVATE_TRANSFER_DIAGNOSTIC");
    return {};
  }
}

final visualKey = GlobalKey();
void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });
  Future<void> pump(
    WidgetTester tester,
    _Api api, {
    bool arabic = false,
    bool openDetails = true,
  }) async {
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
    tester.view.physicalSize = const Size(1500, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final router = GoRouter(
      initialLocation: '/transfers',
      routes: [
        GoRoute(
          path: '/transfers',
          builder: (_, _) => const StockTransfersScreen(),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              isSuperAdmin: true,
            ),
          ),
        ],
        child: RepaintBoundary(
          key: visualKey,
          child: MaterialApp.router(
            theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
            locale: Locale(arabic ? 'ar' : 'en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    if (!openDetails) return;
    await tester.tap(find.byTooltip(arabic ? 'التفاصيل' : 'Details'));
    await tester.pumpAndSettle();
  }

  for (final receive in [false, true]) {
    testWidgets(
      '${receive ? 'receive' : 'dispatch'} quantity cancel is neutral and confirm sends exact line',
      (tester) async {
        final api = _Api(receive ? 'DISPATCHED' : 'APPROVED');
        await pump(tester, api);
        final action = receive ? 'Receive' : 'Dispatch';
        await tester.tap(find.text(action));
        await tester.pumpAndSettle();
        final qty = find.widgetWithText(TextField, 'Qty');
        expect(
          tester.widget<TextField>(qty).controller!.text,
          receive ? '2.0' : '4.0',
        );
        await tester.enterText(qty, '1.25');
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(api.posts, isEmpty);
        await tester.tap(find.text(action));
        await tester.pumpAndSettle();
        await tester.enterText(find.widgetWithText(TextField, 'Qty'), '1.25');
        final before = api.reads;
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(
          api.posts.single.$1,
          '/inventory/stock-transfers/t/${receive ? 'receive' : 'dispatch'}',
        );
        expect(api.posts.single.$2, {
          'lines': [
            {'lineId': 'line', 'quantity': '1.25'},
          ],
        });
        expect(api.keys.single, isNotEmpty);
        expect(api.reads, greaterThan(before));
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
        expect(find.text('TR-OPS'), findsOneWidget);
      },
    );
  }
  testWidgets(
    'settlement cancel is neutral and submit keeps return shortage damage and reason',
    (tester) async {
      final api = _Api('DISPATCHED');
      await pump(tester, api);
      await tester.tap(find.text('Settle differences'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(api.posts, isEmpty);
      await tester.tap(find.text('Settle differences'));
      await tester.pumpAndSettle();
      final fields = find.descendant(
        of: find.byType(AlertDialog).last,
        matching: find.byType(TextField),
      );
      for (var i = 0; i < 4; i++) {
        await tester.enterText(
          fields.at(i),
          ['1', '0.5', '0.25', 'verified shortage'][i],
        );
      }
      await tester.tap(find.text('Submit settlement'));
      await tester.pumpAndSettle();
      expect(api.posts.single.$1, '/inventory/stock-transfers/t/settle');
      expect(api.posts.single.$2, {
        'lines': [
          {
            'lineId': 'line',
            'returnedQuantity': '1',
            'shortage': '0.5',
            'damage': '0.25',
            'reason': 'verified shortage',
          },
        ],
      });
    },
  );
  testWidgets(
    'rejection reason cancel is neutral and confirm sends chosen reason',
    (tester) async {
      final api = _Api('REVIEWED');
      await pump(tester, api);
      await tester.tap(find.text('Reject'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(api.posts, isEmpty);
      await tester.tap(find.text('Reject'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(
          of: find.byType(AlertDialog).last,
          matching: find.byType(TextField),
        ),
        'check source',
      );
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      expect(api.posts.single.$1, '/inventory/stock-transfers/t/reject');
      expect(api.posts.single.$2, {'reason': 'check source'});
    },
  );
  testWidgets(
    'uncertain dispatch retains quantity hides diagnostics and blocks duplicate',
    (tester) async {
      final api = _Api('APPROVED')..refuse = true;
      await pump(tester, api);
      await tester.tap(find.text('Dispatch'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Qty'), '1.25');
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      expect(find.textContaining('PRIVATE_TRANSFER_DIAGNOSTIC'), findsNothing);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Qty'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Qty'))
            .controller!
            .text,
        '1.25',
      );
      expect(api.posts, hasLength(1));
      expect(find.textContaining('outcome is not confirmed'), findsOneWidget);
    },
  );

  testWidgets(
    'HTTP400 receive refusal retains original identity and blocks unproven retry',
    (tester) async {
      final api = _Api('DISPATCHED')..definite = true;
      await pump(tester, api);
      await tester.tap(find.text('Receive'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Qty'), '1.25');
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Qty'))
            .controller!
            .text,
        '1.25',
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        isNull,
      );
      expect(
        tester.widget<TextField>(find.widgetWithText(TextField, 'Qty')).enabled,
        isFalse,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pump(tester, api);
      await tester.tap(find.text('Receive'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Qty'))
            .controller!
            .text,
        '1.25',
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        isNull,
      );
      expect(api.posts, hasLength(1));
    },
  );
  testWidgets('uncertain settlement keeps all amounts and blocks submit', (
    tester,
  ) async {
    final api = _Api('DISPATCHED')..refuse = true;
    await pump(tester, api);
    await tester.tap(find.text('Settle differences'));
    await tester.pumpAndSettle();
    final fields = find.descendant(
      of: find.byType(AlertDialog).last,
      matching: find.byType(TextField),
    );
    for (var i = 0; i < 4; i++) {
      await tester.enterText(fields.at(i), ['1', '0.5', '0.25', 'verified'][i]);
    }
    await tester.tap(find.text('Submit settlement'));
    await tester.pumpAndSettle();
    expect(find.textContaining('PRIVATE_TRANSFER_DIAGNOSTIC'), findsNothing);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField).last).controller!.text,
      'verified',
    );
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Submit settlement'),
          )
          .onPressed,
      isNull,
    );
    final boundary =
        visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await screenshotFile('transfer-settlement-retained.png')
          .writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
  });
  testWidgets(
    'uncertain dispatch survives provider recreation until original key confirmed',
    (tester) async {
      final api = _Api('APPROVED')..refuse = true;
      await pump(tester, api);
      await tester.tap(find.text('Dispatch'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Qty'), '1.25');
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Refresh transfer'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pump(tester, api);
      await tester.tap(find.text('Dispatch'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Qty'))
            .controller!
            .text,
        '1.25',
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        isNull,
      );
      expect(api.posts, hasLength(1));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      api.confirmed = true;
      api.refuse = false;
      await tester.tap(find.text('Refresh transfer'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Dispatch'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        isNotNull,
      );
      expect(api.posts, hasLength(1));
    },
  );
  testWidgets(
    'uncertain reject retains reason after recreation and blocks duplicate',
    (tester) async {
      final api = _Api('REVIEWED')..refuse = true;
      await pump(tester, api);
      await tester.tap(find.text('Reject'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(
          of: find.byType(AlertDialog).last,
          matching: find.byType(TextField),
        ),
        'verify source lot',
      );
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      expect(find.textContaining('PRIVATE_TRANSFER_DIAGNOSTIC'), findsNothing);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pump(tester, api);
      await tester.tap(find.text('Reject'));
      await tester.pumpAndSettle();
      final reason = find.descendant(
        of: find.byType(AlertDialog).last,
        matching: find.byType(TextField),
      );
      expect(
        tester.widget<TextField>(reason).controller!.text,
        'verify source lot',
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        isNull,
      );
      expect(api.posts, hasLength(1));
      final boundary =
          visualKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await screenshotFile('transfer-rejection-retained.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    },
  );
  testWidgets('review requires confirmation and cancel sends nothing', (
    tester,
  ) async {
    final api = _Api('DRAFT');
    await pump(tester, api);
    await tester.tap(find.text('Review'));
    await tester.pumpAndSettle();
    expect(api.posts, isEmpty);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.posts, isEmpty);
    await tester.tap(find.text('Review'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(api.posts.single.$1, '/inventory/stock-transfers/t/review');
  });

  testWidgets(
    'Arabic uncertain rejection retains exact reason and restart block pixels',
    (tester) async {
      final api = _Api('REVIEWED')..refuse = true;
      await pump(tester, api, arabic: true);
      await tester.tap(find.text('رفض'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(
          of: find.byType(AlertDialog).last,
          matching: find.byType(TextField),
        ),
        'تحقق من دفعة المصدر',
      );
      await tester.tap(find.text('تأكيد'));
      await tester.pumpAndSettle();
      expect(find.textContaining('PRIVATE_TRANSFER_DIAGNOSTIC'), findsNothing);
      // Dismiss only the acknowledged error. The original reason stays behind it.
      final ok = find.byType(AlertDialog).last;
      await tester.tap(
        find.descendant(of: ok, matching: find.byType(FilledButton)).last,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('إلغاء'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pump(tester, api, arabic: true);
      await tester.tap(find.text('رفض'));
      await tester.pumpAndSettle();
      final reason = find.descendant(
        of: find.byType(AlertDialog).last,
        matching: find.byType(TextField),
      );
      expect(
        tester.widget<TextField>(reason).controller!.text,
        'تحقق من دفعة المصدر',
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'تأكيد'))
            .onPressed,
        isNull,
      );
      expect(api.posts, hasLength(1));
      expect(tester.takeException(), isNull);
      final boundary =
          visualKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await screenshotFile('transfer-rejection-retained-ar.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    },
  );
  for (final outcome in [
    'COMPLETED',
    'ACCEPTED_STEP',
    'DECISION_RECORDED',
    'PENDING',
    'ABSENT',
    'REVIEW',
    'wrong-key',
    'wrong-action',
  ]) {
    testWidgets('exact review recovery gates $outcome without replay', (
      tester,
    ) async {
      final api = _Api(outcome == 'ACCEPTED_STEP' ? 'REVIEWED' : 'DRAFT')
        ..refuse = true;
      await pump(tester, api);
      final label = outcome == 'ACCEPTED_STEP' ? 'Approve' : 'Review';
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      api.confirmed = true;
      api.proofAction = outcome == 'ACCEPTED_STEP'
          ? 'CHAIN_APPROVE'
          : outcome == 'wrong-action'
          ? 'DISPATCH'
          : 'REVIEWED';
      api.proofState = outcome.startsWith('wrong-') ? 'COMPLETED' : outcome;
      api.wrongProofKey = outcome == 'wrong-key';
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pump(tester, api);
      if (outcome == 'ACCEPTED_STEP') {
        expect(
          find.textContaining('earlier approval step was recorded'),
          findsOneWidget,
        );
        final boundary =
            visualKey.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await screenshotFile('transfer-accepted-step.png')
              .writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
            .onPressed,
        outcome == 'COMPLETED' || outcome == 'ACCEPTED_STEP'
            ? isNotNull
            : isNull,
      );
      expect(api.posts, hasLength(1));
    });
  }
  testWidgets(
    'lost settlement approval race clears only explicit unapplied proof',
    (tester) async {
      final api = _Api('SETTLEMENT_PENDING')..refuse = true;
      await pump(tester, api);
      await tester.tap(find.text('Approve write-off'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      api.confirmed = true;
      api.proofAction = 'SETTLE_ALREADY_DONE';
      api.proofState = 'ALREADY_APPROVED';
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pump(tester, api);
      expect(
        find.textContaining('did not apply another approval'),
        findsOneWidget,
      );
      expect(api.posts, hasLength(1));
    },
  );
  testWidgets(
    'transit report opens scrolls45 rows closes and safe failure acknowledges',
    (tester) async {
      final api = _Api('DRAFT');
      await pump(tester, api, openDetails: false);
      await tester.tap(find.byTooltip('Transfer/transit report'));
      await tester.pumpAndSettle();
      expect(find.text('Transfers & transit report'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(AlertDialog), const Offset(0, -2400));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final boundary =
          visualKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await screenshotFile('transfer-transit-report-scroll.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(find.text('Transfers & transit report'), findsNothing);
      expect(api.posts, isEmpty);
      api.failReport = true;
      await tester.tap(find.byTooltip('Transfer/transit report'));
      await tester.pumpAndSettle();
      expect(find.textContaining('PRIVATE_REPORT_DIAGNOSTIC'), findsNothing);
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );
}
