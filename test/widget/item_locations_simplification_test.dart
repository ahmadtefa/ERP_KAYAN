import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/item_locations_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _LocationsApi extends ApiClient {
  _LocationsApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'warehouses': const <Object>[]};
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

  testWidgets('an item with no visible stock says what happened and the next '
      'step', (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_LocationsApi()),
          currentUserProvider.overrideWithValue(_user),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: ItemLocationsScreen(itemId: 'it-1', itemName: 'Cable'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('No stock for this item in the warehouses you may view'),
      findsOneWidget,
    );
    expect(
      find.textContaining('review the warehouse access or record a receipt'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
