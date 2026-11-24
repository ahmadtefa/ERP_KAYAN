import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  int posts = 0;
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {
        'items': [
          {'id': 'a', 'code': '1', 'name': 'Cash', 'nameEn': 'Cash', 'type': 'asset', 'isActive': true, 'isPostable': true},
          {'id': 'b', 'code': '2', 'name': 'Sales', 'nameEn': 'Sales', 'type': 'revenue', 'isActive': true, 'isPostable': true},
        ],
      };
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => {'items': <Object>[]};
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [];
  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posts++;
    throw const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED',
        fieldErrors: {'lines.1.credit': 'المبلغ غير صحيح لهذا الحساب'});
  }
}

void main() {
  testWidgets('journal line problems appear beside the field and input is kept', (tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _Api();
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(api),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      currentUserProvider.overrideWithValue(const AppUser(
          id: 'u', username: 'u', fullName: 'User', companyId: 'c', branchId: 'b', isSuperAdmin: true)),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: JournalEntriesScreen()),
        )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New journal entry'));
    await tester.pumpAndSettle();

    final debit = find.widgetWithText(TextField, 'Debit');
    final credit = find.widgetWithText(TextField, 'Credit');
    await tester.enterText(debit.at(0), '10');
    await tester.enterText(credit.at(1), '10');
    await tester.pump();
    // Second line has an account, first has an amount but no account.
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2 — Sales').last);
    await tester.pumpAndSettle();
    final save = find.byIcon(Icons.save_outlined);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.text('Choose an account first'), findsWidgets);
    expect(api.posts, 0);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    // Choosing the account clears the mark and keeps the amounts.
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('1 — Cash').last);
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(debit.at(0)).controller!.text, '10');
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(api.posts, 1);
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.widget<TextField>(credit.at(1)).decoration!.errorText, 'المبلغ غير صحيح لهذا الحساب');
    expect(tester.widget<TextField>(credit.at(1)).controller!.text, '10');
    expect(tester.widget<TextField>(debit.at(0)).controller!.text, '10');
  });
}
