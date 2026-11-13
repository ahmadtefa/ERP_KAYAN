import 'dart:async';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _CashRefreshApi extends ApiClient {
  _CashRefreshApi()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://cash-refresh-test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  final listRefresh = Completer<List<Map<String, dynamic>>>();
  final balanceRefresh = Completer<Map<String, dynamic>>();
  final reads = <String, int>{};

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) {
    final count = reads.update(path, (value) => value + 1, ifAbsent: () => 1);
    if (count == 1) return Future.value(const []);
    return listRefresh.future;
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) {
    final count = reads.update(path, (value) => value + 1, ifAbsent: () => 1);
    if (count == 1) return Future.value({'rows': <Map<String, dynamic>>[]});
    return balanceRefresh.future;
  }
}

void main() {
  testWidgets(
    'cash refresh reloads all visible lists and blocks duplicate requests',
    (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final api = _CashRefreshApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            exportCapabilitiesProvider.overrideWith(
              (ref) async => ExportCapabilities.unknown,
            ),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: CashScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(api.reads, {
        '/cash/accounts': 1,
        '/cash/accounts/balances': 1,
        '/cash/vouchers': 1,
        '/cash/transfers': 1,
      });

      final refresh = find.byTooltip('Refresh');
      await tester.tap(refresh);
      await tester.pump();

      expect(api.reads.values, everyElement(2));
      final refreshButton = find.ancestor(
        of: refresh,
        matching: find.byType(IconButton),
      );
      expect(tester.widget<IconButton>(refreshButton).onPressed, isNull);
      expect(find.byKey(const Key('cash-refresh-loading')), findsOneWidget);

      api.listRefresh.complete(const []);
      api.balanceRefresh.complete({'rows': <Map<String, dynamic>>[]});
      await tester.pumpAndSettle();

      expect(api.reads.values, everyElement(2));
      expect(tester.widget<IconButton>(refreshButton).onPressed, isNotNull);
    },
  );
}
