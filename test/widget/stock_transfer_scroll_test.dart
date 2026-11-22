import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_transfers_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _TransferApi extends ApiClient {
  _TransferApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final row = <String, dynamic>{
    'id': 'transfer-1', 'documentNumber': 'TR-1', 'status': 'PARTIALLY_RECEIVED',
    'reason': 'Test', 'transferDate': '2026-11-21',
    'sourceWarehouse': {'nameEn': 'Source', 'nameAr': 'المصدر'},
    'destinationWarehouse': {'nameEn': 'Destination', 'nameAr': 'الوجهة'},
    'lines': [for (var i = 0; i < 30; i++) {
      'id': 'line-$i', 'item': {'nameEn': 'Item $i', 'nameAr': 'صنف $i'},
      'requestedQuantity': '10', 'dispatchedQuantity': '4', 'receivedQuantity': '4',
      'returnedQuantity': '0', 'reportedShortage': '0', 'reportedDamage': '0',
    }],
  };
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [row];
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => row;
}

void main() {
  for (final locale in [const Locale('en'), const Locale('ar')]) {
    testWidgets('transfer details scroll vertically and horizontally in ${locale.languageCode}', (tester) async {
      tester.view.physicalSize = const Size(580, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final router = GoRouter(initialLocation: '/transfers', routes: [
        GoRoute(path: '/transfers', builder: (_, _) => const StockTransfersScreen()),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(_TransferApi()), currentUserProvider.overrideWithValue(testUser)],
        child: MaterialApp.router(locale: locale, localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales, routerConfig: router),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.open_in_new));
      await tester.pumpAndSettle();
      expect(find.byType(Scrollbar), findsAtLeastNWidgets(2));
      final horizontal = find.descendant(of: find.byType(AlertDialog), matching: find.byWidgetPredicate(
        (widget) => widget is SingleChildScrollView && widget.scrollDirection == Axis.horizontal));
      final controller = tester.widget<SingleChildScrollView>(horizontal.first).controller!;
      expect(controller.position.maxScrollExtent, greaterThan(0));
      await tester.drag(horizontal.first, Offset(locale.languageCode == 'ar' ? 300 : -300, 0));
      await tester.pumpAndSettle();
      expect(controller.offset, greaterThan(0));
      // Return to the leading edge so the item names are visible again.
      controller.jumpTo(0);
      await tester.pumpAndSettle();
      final vertical = find.descendant(of: find.byType(AlertDialog), matching: find.byWidgetPredicate(
        (widget) => widget is SingleChildScrollView && widget.scrollDirection == Axis.vertical));
      await tester.drag(vertical.first, const Offset(0, -1700));
      await tester.pumpAndSettle();
      final last = find.text(locale.languageCode == 'ar' ? 'صنف 29' : 'Item 29');
      expect(last, findsOneWidget);
      final dialog = tester.getRect(find.byType(AlertDialog));
      expect(dialog.contains(tester.getCenter(last)), isTrue);
      expect(tester.takeException(), isNull);
    });
  }
}
