import 'dart:io';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/features/data/presentation/screens/backup_screen.dart';
import 'package:erp_kayan/features/data/presentation/screens/import_screen.dart';
import 'package:erp_kayan/features/licensing/data/licence_data_source.dart';
import 'package:erp_kayan/features/licensing/presentation/providers/licence_providers.dart';
import 'package:erp_kayan/features/licensing/presentation/screens/licence_screen.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/approval_policies_screen.dart';
import 'package:erp_kayan/features/settings/presentation/screens/company_settings_screen.dart';
import 'package:erp_kayan/features/settings/presentation/screens/settings_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../widget/test_harness.dart';
import 'screenshot_fixtures.dart';

/// Review pictures of the remaining administration screens: company data,
/// settings, backup, import, licence and approval policies. The real widgets
/// with believable synthetic data; no backend, no real company, no real key.
class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://screenshot.invalid/api/v1'), FakeTokenStore());

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async =>
      {'version': 'synthetic', 'status': 'ok'};

  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async {
    if (path == '/admin/approvals/operations') {
      return {'items': ['STOCK_TRANSFER', 'STOCK_WRITE_OFF', 'JOURNAL_POST']};
    }
    if (path == '/admin/approvals/policies') {
      return {
        'items': [
          {
            'id': 'p1', 'nameEn': 'Large transfers between warehouses', 'nameAr': 'تحويلات كبيرة بين المخازن',
            'operation': 'STOCK_TRANSFER', 'priority': 10, 'isActive': true, 'minimumAmount': '50000',
            'levels': [
              {'level': 1, 'nameEn': 'Storekeeper manager', 'nameAr': 'مدير المخازن', 'permission': 'inventory.transfers.approve', 'roleCode': 'STOREKEEPER'},
              {'level': 2, 'nameEn': 'General manager', 'nameAr': 'المدير العام', 'permission': 'admin.approvals.approve', 'roleCode': 'ADMIN'},
            ],
          },
          {
            'id': 'p2', 'nameEn': 'Stock write-offs', 'nameAr': 'إعدام مخزون',
            'operation': 'STOCK_WRITE_OFF', 'priority': 20, 'isActive': true,
            'levels': [
              {'level': 1, 'nameEn': 'Accountant', 'nameAr': 'المحاسب', 'permission': 'inventory.writeoff.approve', 'roleCode': 'ACCOUNTANT'},
            ],
          },
        ],
      };
    }
    return {'items': []};
  }

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/company/branches') {
      return [{'id': 'b1', 'code': 'HQ', 'nameEn': 'Headquarters', 'nameAr': 'المقر الرئيسي'}];
    }
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'w1', 'code': 'W1', 'nameEn': 'Main warehouse', 'nameAr': 'المخزن الرئيسي'},
        {'id': 'w2', 'code': 'W2', 'nameEn': 'Showroom', 'nameAr': 'المعرض'},
      ];
    }
    return [];
  }
}

class _Profile extends CompanyProfileController {
  @override
  Future<Map<String, dynamic>> build() async => const {
    'id': 'company-1', 'code': 'NOUR-01', 'nameAr': 'شركة النور للتجارة', 'nameEn': 'Al Nour Trading Co',
    'taxId': '300123456', 'phone': '+20 100 000 0000', 'email': 'info@alnour.test',
    'address': 'Cairo, Egypt', 'hasLogo': false,
  };
}

class _Branches extends BranchesController {
  @override
  Future<List<Map<String, dynamic>>> build() async => const [
    {'id': 'b1', 'code': 'HQ', 'nameAr': 'المقر الرئيسي', 'nameEn': 'Headquarters', 'kind': 'HEADQUARTERS', 'isActive': true},
    {'id': 'b2', 'code': 'ALX', 'nameAr': 'فرع الإسكندرية', 'nameEn': 'Alexandria branch', 'kind': 'BRANCH', 'isActive': true},
  ];
}

class _FullBackup extends FullBackupService {
  _FullBackup() : super(Dio());
  @override
  Future<Map<String, dynamic>> capabilities() async => const {};
  @override
  Future<List<Map<String, dynamic>>> list() async => const [];
}

class _SystemBackup extends SystemBackupService {
  _SystemBackup() : super(Dio());
  @override
  Future<Map<String, dynamic>> capabilities() async => const {'available': true, 'fullRestoreSupported': false, 'fullRestoreReasons': <String>[]};
  @override
  Future<List<Map<String, dynamic>>> list() async => const [];
  @override
  Future<Map<String, dynamic>> status() async => const {'maintenance': false, 'journal': {'unfinished': false}};
}

final _licence = LicenceStatus.fromJson({
  'state': 'ACTIVE', 'blocked': false, 'configured': true, 'enforcement': 'enforce',
  'machineId': 'SYNTHETIC-MACHINE-0001', 'installId': 'SYNTHETIC-INSTALL-0001',
  'seats': {'limit': 10, 'used': 4, 'available': 6},
  'licenseId': 'SYNTHETIC-LICENCE', 'issuedAt': '2026-01-01T00:00:00Z',
  'startsAt': '2026-01-01T00:00:00Z', 'expiresAt': '2027-01-01T00:00:00Z', 'daysRemaining': 35,
  'clock': {'state': 'OK'},
});

Future<void> _fonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    final loader = FontLoader('IBMPlexSansArabic');
    for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$w.ttf').readAsBytesSync())));
    }
    await loader.load();
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();
  });
}

Future<void> _shoot(WidgetTester tester, GlobalKey key, String name) async {
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await screenshotFile('$name.png').writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final screens = <String, Widget>{
    'company': const CompanySettingsScreen(),
    'settings': const SettingsScreen(),
    'backup': const BackupScreen(),
    'import': const ImportScreen(),
    'licence': const LicenceScreen(),
    'approval_policies': const ApprovalPoliciesScreen(),
  };

  for (final arabic in [true, false]) {
    for (final light in [false, true]) {
      for (final entry in screens.entries) {
        final tag = '${arabic ? 'ar' : 'en'}_${light ? 'light' : 'dark'}';
        testWidgets('admin pictures: ${entry.key} ($tag)', (tester) async {
          await _fonts(tester);
          tester.view.physicalSize = const Size(1500, 1000);
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final key = GlobalKey();
          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                appConfigProvider.overrideWithValue(const AppConfig(
                  environment: AppEnvironment.onPremise,
                  apiBaseUrl: 'http://unused.invalid/api/v1',
                  connectTimeout: Duration(seconds: 1),
                  receiveTimeout: Duration(seconds: 1),
                )),
                apiClientProvider.overrideWithValue(_Api()),
                currentUserProvider.overrideWithValue(screenshotAdmin),
                companyProfileProvider.overrideWith(() => _Profile()),
                branchesProvider.overrideWith(() => _Branches()),
                licenceStatusProvider.overrideWith((ref) async => _licence),
                backupSummaryProvider.overrideWith((ref) async => const {
                  'companyName': 'Al Nour Trading Co',
                  'contains': <String, int>{'customers': 128, 'suppliers': 46, 'items': 412, 'salesInvoices': 1893, 'purchaseInvoices': 604, 'journalEntries': 5210},
                  'total': 8293,
                }),
                fullBackupServiceProvider.overrideWithValue(_FullBackup()),
                systemBackupServiceProvider.overrideWithValue(_SystemBackup()),
              ],
              child: RepaintBoundary(
                key: key,
                child: MaterialApp(
                  debugShowCheckedModeBanner: false,
                  locale: Locale(arabic ? 'ar' : 'en'),
                  theme: light ? AppTheme.light() : AppTheme.dark(),
                  localizationsDelegates: AppLocalizations.localizationsDelegates,
                  supportedLocales: AppLocalizations.supportedLocales,
                  home: Scaffold(body: entry.value),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await _shoot(tester, key, 'admin_${entry.key}_$tag');
        });
      }
    }
  }
}
