import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/cost_center_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/cost_centers_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
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
];

const _user = AppUser(
  id: 'user-1',
  username: 'accountant',
  fullName: 'Accountant',
  companyId: 'company-1',
  permissions: ['accounting.costcenters.read', 'accounting.costcenters.manage'],
);

Future<void> _pump(WidgetTester tester, {required List<Json> centres}) async {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        costCentersProvider.overrideWith((ref) async => centres),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
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

  testWidgets('the cost-centre form groups its fields under short headings', (
    tester,
  ) async {
    await _pump(tester, centres: _centres);

    await tester.tap(find.text('New cost center'));
    await tester.pumpAndSettle();

    expect(find.text('Cost centre details'), findsOneWidget);
    expect(find.text('Parent and type'), findsOneWidget);
    expect(find.text('Owner and dates'), findsOneWidget);
    expect(find.text('Notes'), findsOneWidget);
    // The parent field says what "no parent" means instead of leaving it to
    // be discovered.
    expect(
      find.text('No parent makes it a top-level centre in the tree.'),
      findsOneWidget,
    );
    // Labels the existing draft test types into are unchanged.
    expect(find.widgetWithText(TextFormField, 'Name in English'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Responsible person'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty list says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, centres: const []);

    expect(find.textContaining('No cost centres to show'), findsOneWidget);
    expect(find.textContaining('New cost centre'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
