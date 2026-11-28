import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _JournalApi extends ApiClient {
  _JournalApi({required this.entries})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final List<Map<String, dynamic>> entries;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => path == '/accounting/journal-entries' ? entries : const [];

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'items': const <Object>[]};

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'items': const <Object>[]};
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  branchId: 'b',
  isSuperAdmin: true,
);

Future<void> _pump(
  WidgetTester tester,
  List<Map<String, dynamic>> entries,
) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_JournalApi(entries: entries)),
        appConfigProvider.overrideWithValue(
          AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        ),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: JournalEntriesScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an empty journal says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, const []);

    expect(find.textContaining('No journal entries yet'), findsOneWidget);
    expect(find.textContaining('New journal entry'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a journal row shows its date with the year', (tester) async {
    await _pump(tester, [
      {
        'id': 'entry',
        'entryNumber': 'JE-1',
        'entryDate': '2026-03-05',
        'description': 'Rent accrual',
        'status': 'draft',
        'totalDebit': '1200',
        'totalCredit': '1200',
      },
    ]);

    expect(find.textContaining('March 5, 2026'), findsOneWidget);
    expect(find.textContaining('2026-03-05'), findsNothing);
    expect(find.textContaining('1,200.00'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
