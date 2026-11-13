// Dedicated CI integration test: real chart widget -> real Dio/HTTP -> Nest
// controller/service -> disposable PostgreSQL. The fixture injects an
// identity, so this is NOT a JWT, licensing, installed-Windows or E2E test.
import 'dart:io';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// The usual widget binding replaces HttpClient with a 400 stub. This isolated
// test explicitly uses the real socket client, limited to the CI fixture.
class _NetworkTestBinding extends AutomatedTestWidgetsFlutterBinding {
  @override
  bool get overrideHttpClient => false;
}

class _EmptySecureBackend implements SecureTokenBackend {
  @override
  Future<void> delete(String key) async {}
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> write(String key, String value) async {}
}

Future<void> _waitFor(WidgetTester tester, Finder finder, {bool absent = false}) async {
  for (var attempt = 0; attempt < 200; attempt++) {
    await tester.pump(const Duration(milliseconds: 20));
    if (finder.evaluate().isNotEmpty != absent) return;
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
  }
  fail('Timed out waiting for $finder (absent=$absent) after real HTTP activity');
}

void main() {
  _NetworkTestBinding();
  testWidgets('chart create edit activate and refresh use real HTTP and PostgreSQL', (tester) async {
    final env = Platform.environment;
    final origin = Uri.tryParse(env['KAYAN_CHART_INTEGRATION_ORIGIN'] ?? '');
    if (env['GITHUB_ACTIONS'] != 'true' || env['RUNNER_ENVIRONMENT'] != 'github-hosted' ||
        env['KAYAN_CHART_INTEGRATION'] != 'disposable-ci' || origin == null ||
        origin.scheme != 'http' || origin.host != '127.0.0.1' || !origin.hasPort ||
        origin.path.isNotEmpty || origin.hasQuery || origin.hasFragment || origin.userInfo.isNotEmpty) {
      throw StateError('This test requires the isolated CI loopback fixture');
    }
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final config = AppConfig.forLocalServer(origin.toString());
    final client = ApiClient(config, TokenStore(backend: _EmptySecureBackend()));
    addTearDown(() => client.raw.close(force:true));
    await tester.pumpWidget(ProviderScope(overrides: [
      appConfigProvider.overrideWithValue(config),
      apiClientProvider.overrideWithValue(client),
      currentUserProvider.overrideWithValue(const AppUser(id:'synthetic',username:'synthetic',
        fullName:'Synthetic',companyId:'synthetic',permissions:['accounting.accounts.read',
          'accounting.accounts.create','accounting.accounts.update'])),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
    ], child: MaterialApp(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,
      home:const Scaffold(body:ChartOfAccountsScreen()))));
    await tester.enterText(find.byType(TextField).first, 'SYN-ROOT');
    await _waitFor(tester,find.textContaining('SYN-ROOT'));
    await tester.tap(find.text('New account'));
    await _waitFor(tester,find.widgetWithText(TextField,'Name in English'));
    await tester.enterText(find.widgetWithText(TextField,'Code'),'SYN-UI-ACCOUNT-1');
    await tester.enterText(find.widgetWithText(TextField,'Name in English'),'Integration asset');
    await tester.tap(find.text('Save'));
    await _waitFor(tester,find.widgetWithText(TextField,'Name in English'),absent:true);
    await tester.enterText(find.byType(TextField).first, 'SYN-UI-ACCOUNT-1');
    await _waitFor(tester,find.textContaining('SYN-UI-ACCOUNT-1  Integration asset'));
    await tester.tap(find.byTooltip('Edit account'));
    await _waitFor(tester,find.widgetWithText(TextField,'Name in English'));
    await tester.enterText(find.widgetWithText(TextField,'Name in English'),'Integration asset revised');
    await tester.tap(find.text('Save'));
    await _waitFor(tester,find.widgetWithText(TextField,'Name in English'),absent:true);
    await _waitFor(tester,find.textContaining('SYN-UI-ACCOUNT-1  Integration asset revised'));
    await tester.tap(find.byTooltip('Deactivate account'));
    await _waitFor(tester,find.byTooltip('Activate account'));
    await tester.tap(find.byTooltip('Activate account'));
    await _waitFor(tester,find.byTooltip('Deactivate account'));
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pump();
    await _waitFor(tester,find.textContaining('SYN-UI-ACCOUNT-1  Integration asset revised'));
    expect(tester.takeException(),isNull);
    // Dispose the page and close Dio before the binding checks for fake-async
    // timers; a kept-alive socket otherwise leaves a three-second idle timer.
    await tester.pumpWidget(const SizedBox.shrink());
    client.raw.close(force:true);
    await tester.pump(const Duration(seconds:4));
  });
}
