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
    return path.endsWith('/approvals') ? {} : row;
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add((path, body));
    keys.add(idempotencyKey);
    return {};
  }
}

void main() {
  Future<void> pump(WidgetTester tester, _Api api) async {
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
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Details'));
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
}
