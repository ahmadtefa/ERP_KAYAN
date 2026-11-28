import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/expiry_alerts_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _ExpiryApi extends ApiClient {
  _ExpiryApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {
    'asOf': '2026-03-01',
    'horizonDays': 90,
    'counts': {
      'expired': 0,
      'expiringSoon': 0,
      'valid': 0,
      'total': 0,
    },
    'items': const <Object>[],
  };
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  isSuperAdmin: true,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an empty alert list says what happened and the next step', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_ExpiryApi()),
          currentUserProvider.overrideWithValue(_user),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: ExpiryAlertsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Nothing to alert on'), findsOneWidget);
    expect(
      find.textContaining('Record an expiry date when you receive a lot'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
