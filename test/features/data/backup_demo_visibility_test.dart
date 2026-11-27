import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/features/data/presentation/screens/backup_screen.dart';
import 'package:erp_kayan/features/data/presentation/widgets/auto_backup_section.dart';
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

/// The complete-backup half of the screen has its own service. It is answered
/// here too, or the screen would open a socket from a widget test and keep a
/// progress bar turning while it waited.
class _FakeSystemBackupService extends SystemBackupService {
  _FakeSystemBackupService() : super(Dio());

  @override
  Future<Map<String, dynamic>> capabilities() async => const {
    'available': true,
    'fullRestoreSupported': false,
    'fullRestoreReasons': ['not in this test'],
  };

  @override
  Future<List<Map<String, dynamic>>> list() async => const [];

  @override
  Future<Map<String, dynamic>> status() async => const {
    'maintenance': false,
    'journal': {'unfinished': false},
  };
}

class _FakeAutoBackupService extends AutoBackupService {
  _FakeAutoBackupService() : super(Dio());

  @override
  Future<Map<String, dynamic>> settings() async => const {
    'intervalHours': 168, 'retentionCount': 14, 'destinationPath': null, 'startHour': 2,
  };

  @override
  Future<Map<String, dynamic>> status() async => const {
    'enabled': true, 'intervalHours': 168, 'retentionCount': 14, 'lastRun': null, 'nextDueAt': null,
  };

  @override
  Future<List<Map<String, dynamic>>> history() async => const [];
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
          systemBackupServiceProvider.overrideWithValue(
            _FakeSystemBackupService(),
          ),
          autoBackupServiceProvider.overrideWithValue(_FakeAutoBackupService()),
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
