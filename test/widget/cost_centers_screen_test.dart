import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/cost_center_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/cost_centers_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/screens/module_scaffold.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _centres = <Json>[
  {
    'id': 'cc-root',
    'code': 'CC-1',
    'nameEn': 'Head office',
    'nameAr': 'المكتب الرئيسي',
    'type': 'DEPARTMENT',
    'isActive': true,
    'parentId': null,
    'depth': 0,
  },
  {
    'id': 'cc-project',
    'code': 'CC-2',
    'nameEn': 'Project two',
    'nameAr': 'المشروع الثاني',
    'type': 'PROJECT',
    'isActive': true,
    'parentId': 'cc-root',
    'depth': 1,
  },
  {
    'id': 'cc-old',
    'code': 'CC-3',
    'nameEn': 'Closed unit',
    'nameAr': 'وحدة مغلقة',
    'type': 'ADMINISTRATIVE_UNIT',
    'isActive': false,
    'parentId': null,
    'depth': 0,
  },
];

AppUser _user({required bool manage}) => AppUser(
  id: 'user-1',
  username: 'accountant',
  fullName: 'Accountant',
  companyId: 'company-1',
  permissions: manage
      ? const ['accounting.costcenters.read', 'accounting.costcenters.manage']
      : const ['accounting.costcenters.read'],
);

Future<void> _pump(WidgetTester tester, {required bool manage}) async {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        costCentersProvider.overrideWith((ref) async => _centres),
        currentUserProvider.overrideWithValue(_user(manage: manage)),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: CostCentersScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the cost-center screen lists the hierarchy and filters it', (
    tester,
  ) async {
    await _pump(tester, manage: true);

    expect(find.text('Head office'), findsOneWidget);
    expect(find.text('CC-3'), findsOneWidget);
    // The child is indented under its parent; the server sent the depth.
    expect(find.text('   CC-2'), findsOneWidget);
    expect(find.text('Inactive'), findsOneWidget);

    // Search narrows the visible rows without a round trip.
    final search = find.descendant(
      of: find.byType(SearchField),
      matching: find.byType(TextField),
    );
    await tester.enterText(search, 'project two');
    await tester.pumpAndSettle();

    expect(find.text('   CC-2'), findsOneWidget);
    expect(find.text('Head office'), findsNothing);

    await tester.enterText(search, '');
    await tester.pumpAndSettle();
    expect(find.text('Head office'), findsOneWidget);
  });

  testWidgets('without the manage permission no write action is offered', (
    tester,
  ) async {
    await _pump(tester, manage: false);

    expect(find.text('New cost center'), findsNothing);
    expect(find.text('Head office'), findsOneWidget);
    // The rows are still readable: read access is not the same as write access.
    expect(find.byType(DropdownButtonFormField<String>), findsNWidgets(3));
  });

  testWidgets('with the manage permission the create action is offered', (
    tester,
  ) async {
    await _pump(tester, manage: true);
    expect(find.text('New cost center'), findsOneWidget);
  });
}
