import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart' show apiClientProvider;
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _OfferApi extends ApiClient {
  _OfferApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {
    'quotationDate': '2026-01-01',
    'subject': 'existing offer',
    'tables': <Object>[],
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> put(String path, {Object? body}) async => {};
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the offer date reads as a date, not as a stored string', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1500, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_OfferApi()),
          itemsProvider.overrideWith((ref) async => []),
          customersProvider.overrideWith((ref) async => []),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const QuotationEditorScreen(quotationId: 'offer'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Quotation date: January 1, 2026'),
      findsWidgets,
    );
    expect(find.textContaining('2026-01-01'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
