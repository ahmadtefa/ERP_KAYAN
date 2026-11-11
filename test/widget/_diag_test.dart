import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  @override
  Future<List<Map<String, dynamic>>> getList(String p, {Map<String, dynamic>? query}) async => const [];
  @override
  Future<Map<String, dynamic>> getObject(String p, {Map<String, dynamic>? query}) async => const {};
}

void main() {
  testWidgets('screenshot: diagnose shell build', (tester) async {
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(_Api()),
      tokenStoreProvider.overrideWithValue(FakeTokenStore()),
      currentUserProvider.overrideWithValue(const AppUser(
        id: 'u', username: 'u', fullName: 'u', companyId: 'c',
        permissions: ['inventory.warehouses.read'],
      )),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: ErpShell(
          currentPath: '/inventory/warehouses',
          guardKey: const ValueKey('k1'),
          child: const Scaffold(body: Text('inner')),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    final e = tester.takeException();
    if (e != null) {
      // ignore: avoid_print
      print('DIAG Exception: ${e.runtimeType}: $e');
    }
    expect(e, isNull);
  });
}
