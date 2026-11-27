import 'package:dio/dio.dart';
import 'package:erp_kayan/features/data/presentation/widgets/auto_backup_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Fake extends AutoBackupService {
  _Fake({this.failed = false}) : super(Dio());

  final bool failed;
  Map<String, dynamic>? saved;
  int runs = 0;

  @override
  Future<Map<String, dynamic>> settings() async => const {
        'intervalHours': 168,
        'retentionCount': 14,
        'destinationPath': null,
        'startHour': 2,
      };

  @override
  Future<Map<String, dynamic>> status() async => {
        'enabled': true,
        'intervalHours': 168,
        'retentionCount': 14,
        'lastRun': failed ? {'createdAt': '2026-11-27T10:00:00.000Z', 'status': 'FAILED', 'fileName': '-'} : null,
        'nextDueAt': null,
      };

  @override
  Future<List<Map<String, dynamic>>> history() async => failed
      ? const [
          {'createdAt': '2026-11-27T10:00:00.000Z', 'status': 'FAILED', 'fileName': '-', 'message': 'Backup failed.'}
        ]
      : const [];

  @override
  Future<Map<String, dynamic>> save(Map<String, dynamic> body) async {
    saved = body;
    return body;
  }

  @override
  Future<List<dynamic>> runNow() async {
    runs++;
    return [
      {'status': 'SUCCESS'}
    ];
  }
}

Future<void> _pump(WidgetTester tester, _Fake fake) => tester.pumpWidget(
      ProviderScope(
        overrides: [autoBackupServiceProvider.overrideWithValue(fake)],
        child: wrapWithApp(
          locale: const Locale('en'),
          child: const Scaffold(body: SingleChildScrollView(child: AutoBackupSection())),
        ),
      ),
    );

void main() {
  testWidgets('shows weekly default and saves chosen settings', (tester) async {
    tester.view.physicalSize = const Size(1200, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fake = _Fake();
    await _pump(tester, fake);
    await tester.pumpAndSettle();
    expect(find.text('Weekly'), findsOneWidget);
    expect(find.byKey(const Key('auto-backup-failed-banner')), findsNothing);
    await tester.enterText(find.byKey(const Key('auto-backup-keep')), '7');
    await tester.tap(find.widgetWithText(FilledButton, 'Save settings'));
    await tester.pumpAndSettle();
    expect(fake.saved?['intervalHours'], 168);
    expect(fake.saved?['retentionCount'], 7);
    expect(fake.saved?['destinationPath'], isNull);
    expect(find.text('The automatic backup settings were saved.'), findsOneWidget);
  });

  testWidgets('rejects a bad number of copies before calling the server', (tester) async {
    tester.view.physicalSize = const Size(1200, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fake = _Fake();
    await _pump(tester, fake);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('auto-backup-keep')), '0');
    await tester.tap(find.widgetWithText(FilledButton, 'Save settings'));
    await tester.pumpAndSettle();
    expect(fake.saved, isNull);
    expect(find.textContaining('copies to keep is not valid'), findsOneWidget);
  });

  testWidgets('a failed last run shows the red banner; back up now works', (tester) async {
    tester.view.physicalSize = const Size(1200, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fake = _Fake(failed: true);
    await _pump(tester, fake);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('auto-backup-failed-banner')), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Back up now'));
    await tester.pumpAndSettle();
    expect(fake.runs, 1);
    expect(find.text('The backup was created and verified.'), findsOneWidget);
  });
}
