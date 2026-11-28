import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/company_settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

const _admin = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'fixture-company',
  isSuperAdmin: true,
);

class _Profile extends CompanyProfileController {
  @override
  Future<Map<String, dynamic>> build() async => {
    'id': 'fixture-company',
    'code': 'FX',
    'nameEn': 'Fixture company',
    'nameAr': 'شركة',
    'hasLogo': false,
  };
}

class _NoBranches extends BranchesController {
  @override
  Future<List<Map<String, dynamic>>> build() async => const [];
}

void _size(WidgetTester tester) {
  tester.view.physicalSize = const Size(1500, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('company settings with no branches says how to add one', (
    tester,
  ) async {
    _size(tester);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(_admin),
          companyProfileProvider.overrideWith(() => _Profile()),
          branchesProvider.overrideWith(() => _NoBranches()),
        ],
        child: wrapWithApp(child: const Scaffold(body: CompanySettingsScreen())),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('No branches yet. Choose "New branch" to add the first one.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
