import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/approval_policies_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  int posts = 0;
  Object? refuse;
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => switch (path) {
    '/admin/approvals/operations' => {
      'items': ['STOCK_TRANSFER'],
    },
    _ => {'items': []},
  };
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts += 1;
    final failure = refuse;
    if (failure != null) throw failure;
    return {'id': 'p'};
  }
}

void main() {
  testWidgets('policy editor names each invalid field and places the server refusal', (tester) async {
    tester.view.physicalSize = const Size(1500, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _Api();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(const AppUser(
          id: 'u', username: 'u', fullName: 'u', companyId: 'c', isSuperAdmin: true)),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ApprovalPoliciesScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New policy'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Minimum value'), 'abc');
    // The default level is prefilled; blank its name and permission.
    await tester.enterText(find.widgetWithText(TextFormField, 'Level name (Arabic)'), '');
    await tester.enterText(find.widgetWithText(TextFormField, 'Level name (English)'), '');
    await tester.enterText(find.widgetWithText(TextFormField, 'Required permission'), '');
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(api.posts, 0);
    expect(find.text('A name is required'), findsOneWidget);
    expect(find.text('Enter a number, zero or more'), findsOneWidget);
    expect(find.text('The level name is required'), findsOneWidget);
    expect(find.text('Name the permission that decides who approves this level'), findsOneWidget);
    // Editing a field clears only its own reason.
    await tester.enterText(find.widgetWithText(TextField, 'Name (Arabic)'), 'سياسة');
    await tester.pump();
    expect(find.text('A name is required'), findsNothing);
    expect(find.text('Enter a number, zero or more'), findsOneWidget);
    // Fix the rest; the server then refuses the level permission.
    await tester.enterText(find.widgetWithText(TextField, 'Minimum value'), '100');
    await tester.enterText(find.widgetWithText(TextFormField, 'Level name (Arabic)'), 'مدير');
    await tester.enterText(find.widgetWithText(TextFormField, 'Required permission'), 'nope.nope');
    api.refuse = const ApiFailure(
      'Validation failed',
      statusCode: 422,
      fieldErrors: {'levels.0.permission': 'That permission does not exist'},
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(api.posts, 1);
    expect(find.text('That permission does not exist'), findsOneWidget);
    // The dialog is still open with the input kept.
    expect(find.widgetWithText(FilledButton, 'Save'), findsOneWidget);
  });
}
