import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/company_settings_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _Profile extends CompanyProfileController {
  int sent = 0;
  Object? answer;
  @override
  Future<Map<String, dynamic>> build() async => {
    'id': 'company',
    'code': 'CO',
    'nameAr': 'شركة',
    'nameEn': 'Company',
    'taxId': '',
    'phone': '',
    'email': '',
    'address': '',
    'hasLogo': false,
  };
  @override
  Future<Object?> updateProfile(Map<String, dynamic> patch) async {
    sent += 1;
    return answer;
  }
}

class _Branches extends BranchesController {
  @override
  Future<List<Map<String, dynamic>>> build() async => [];
}

void main() {
  testWidgets('invalid profile fields are named under each field and nothing is sent; a server refusal lands under its field', (tester) async {
    tester.view.physicalSize = const Size(1500, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final container = ProviderContainer(overrides: [
      currentUserProvider.overrideWithValue(const AppUser(
        id: 'u', username: 'u', fullName: 'u', companyId: 'company', isSuperAdmin: true)),
      companyProfileProvider.overrideWith(_Profile.new),
      branchesProvider.overrideWith(_Branches.new),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: CompanySettingsScreen()),
      ),
    ));
    await tester.pumpAndSettle();
    final controller = container.read(companyProfileProvider.notifier) as _Profile;
    Future<void> type(String label, String text) async {
      await tester.enterText(find.widgetWithText(TextField, label), text);
      await tester.pump();
    }

    await type('Company code', 'X');
    await type('Name in Arabic', '');
    await type('Email', 'not-an-email');
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(controller.sent, 0);
    expect(find.textContaining('Use 2 to 20 characters'), findsOneWidget);
    expect(find.text('The name is required'), findsOneWidget);
    expect(find.textContaining('Enter a valid email'), findsOneWidget);
    // Editing one field clears only its own reason.
    await type('Email', 'a@b.co');
    expect(find.textContaining('Enter a valid email'), findsNothing);
    expect(find.text('The name is required'), findsOneWidget);
    // Fix the rest, and the server then refuses one field.
    await type('Company code', 'KAYAN');
    await type('Name in Arabic', 'كيان');
    controller.answer = const ApiFailure(
      'Validation failed',
      statusCode: 422,
      fieldErrors: {'code': 'This code belongs to another company'},
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(controller.sent, 1);
    expect(find.text('This code belongs to another company'), findsOneWidget);
  });
}
