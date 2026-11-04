import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/document_settings_card.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> openSettings(WidgetTester tester, {required bool superAdmin}) async {
  final user = AppUser(id:'synthetic',username:'synthetic',fullName:'Synthetic',companyId:'company',
    permissions:const ['reports.read','admin.company.manage'],isSuperAdmin:superAdmin);
  await tester.pumpWidget(ProviderScope(overrides:[
    currentUserProvider.overrideWithValue(user),
    companySettingsProvider.overrideWith((ref) async => {'maxDiscountPercent':'100','showTaxIdOnQuotations':true}),
  ],child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
    supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:DocumentSettingsCard()))));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('delegated company permission is read-only without super admin', (tester) async {
    await openSettings(tester,superAdmin:false);
    expect(find.text('Only the super administrator can change these settings.'),findsOneWidget);
    expect(find.text('Save settings'),findsNothing);
    expect(tester.widget<TextField>(find.widgetWithText(TextField,'Maximum discount %')).enabled,isFalse);
  });
  testWidgets('super administrator can edit the document settings', (tester) async {
    await openSettings(tester,superAdmin:true);
    expect(find.text('Save settings'),findsOneWidget);
    expect(tester.widget<TextField>(find.widgetWithText(TextField,'Maximum discount %')).enabled,isTrue);
  });
}
