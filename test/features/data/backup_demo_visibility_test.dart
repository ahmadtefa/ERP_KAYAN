import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/features/data/presentation/screens/backup_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeFullBackupService extends FullBackupService {
  _FakeFullBackupService() : super(Dio());

  @override
  Future<Map<String, dynamic>> capabilities() async => const {};

  @override
  Future<List<Map<String, dynamic>>> list() async => const [];
}

void main() {
  for (final environment in AppEnvironment.values) {
    testWidgets('sample visibility for $environment preserves real backup', (tester) async {
      tester.view.physicalSize = const Size(1200, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(AppConfig(
            environment: environment,
            apiBaseUrl: 'http://unused.invalid/api/v1',
            connectTimeout: const Duration(seconds: 1),
            receiveTimeout: const Duration(seconds: 1),
          )),
          backupSummaryProvider.overrideWith((ref) async => const {
            'companyName': 'Synthetic', 'contains': <String, int>{}, 'total': 0,
          }),
          fullBackupServiceProvider.overrideWithValue(_FakeFullBackupService()),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: BackupScreen()),
        ),
      ));
      await tester.pumpAndSettle();
      final visible = environment == AppEnvironment.development ||
          environment == AppEnvironment.staging;
      expect(find.text('Try the sample company'), visible ? findsOneWidget : findsNothing);
      expect(find.text('Take a copy of the data'), findsOneWidget);
      expect(find.text('Restore from a copy'), findsOneWidget);
      expect(find.text('Download the backup'), findsOneWidget);
    });
  }
}
