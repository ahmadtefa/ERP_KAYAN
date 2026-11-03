import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/company_settings_screen.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/company_management_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Profile extends CompanyProfileController {
  @override
  Future<Map<String, dynamic>> build() async => {
    'id': 'fixture-company', 'code': 'FX', 'nameEn': 'Fixture company',
    'nameAr': 'شركة', 'hasLogo': false,
  };
}

class _Branches extends BranchesController {
  @override
  Future<List<Map<String, dynamic>>> build() async => [];
}

class _Client extends ApiClient {
  _Client() : super(
    const AppConfig(
      environment: AppEnvironment.development,
      apiBaseUrl: 'https://test.invalid/api/v1',
      connectTimeout: Duration(seconds: 1),
      receiveTimeout: Duration(seconds: 1),
    ),
    FakeTokenStore(),
  );
  int profileReads = 0;

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    if (path == '/companies/profile') profileReads++;
    return {'id': 'fixture-company', 'nameEn': 'Fixture company', 'hasLogo': false};
  }
}

AppUser _user(bool superAdmin) => AppUser(
  id: 'u', username: 'fixture', fullName: 'Fixture', companyId: 'fixture-company',
  isSuperAdmin: superAdmin,
  permissions: superAdmin ? const [] : const ['admin.company.manage', 'company.profile.manage'],
);

void main() {
  for (final isSuper in [false, true]) {
    testWidgets('profile screen ${isSuper ? 'allows super admin' : 'does not offer delegated profile edits'}', (tester) async {
      tester.view.physicalSize = const Size(1500, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(_user(isSuper)),
          companyProfileProvider.overrideWith(() => _Profile()),
          branchesProvider.overrideWith(() => _Branches()),
        ],
        child: wrapWithApp(child: const Scaffold(body: CompanySettingsScreen())),
      ));
      await tester.pumpAndSettle();
      final fields = tester.widgetList<TextField>(find.byType(TextField)).toList();
      expect(fields.length, 7);
      expect(fields.every((field) => field.enabled == isSuper), isTrue);
      expect(find.widgetWithText(FilledButton, 'Save'), isSuper ? findsOneWidget : findsNothing);
      expect(find.widgetWithText(TextButton, 'Upload logo'), isSuper ? findsOneWidget : findsNothing);
    });

    testWidgets('management panel ${isSuper ? 'permits super admin without delegated permission' : 'hides delegated action'}', (tester) async {
      final client = _Client();
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(_user(isSuper)),
          apiClientProvider.overrideWithValue(client),
        ],
        child: wrapWithApp(child: const Scaffold(body: CompanyManagementPanel())),
      ));
      await tester.pumpAndSettle();
      expect(client.profileReads, isSuper ? 1 : 0);
      expect(find.text('Company profile and logo'), isSuper ? findsOneWidget : findsNothing);
    });
  }
}
