import 'dart:async';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/features/data/presentation/widgets/full_backup_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// A backup service whose answers each test scripts. No server, no files —
/// only the section's state machine is under test: every path must end in a
/// visible result, never in a progress bar that outlives the operation (the
/// reported bug was an endless loading bar with no file and no message).
class _FakeFullBackupService extends FullBackupService {
  _FakeFullBackupService() : super(Dio());

  Object? capabilitiesError;
  Completer<Map<String, dynamic>>? createGate;
  Object? createError;
  List<Map<String, dynamic>> files = const [];
  List<Map<String, dynamic>> filesAfterCreate = const [];
  bool createCalled = false;

  @override
  Future<Map<String, dynamic>> capabilities() async {
    final error = capabilitiesError;
    if (error != null) throw error;
    return const {'available': true};
  }

  @override
  Future<List<Map<String, dynamic>>> list() async =>
      createCalled ? filesAfterCreate : files;

  @override
  Future<Map<String, dynamic>> create() async {
    createCalled = true;
    final gate = createGate;
    if (gate != null) return gate.future;
    final error = createError;
    if (error != null) throw error;
    return const {
      'file': {'name': 'kayan-full-test.dump'},
    };
  }

  @override
  Future<Map<String, dynamic>> restore({
    PickedFile? file,
    String? fileName,
    required bool confirm,
  }) async => const {};
}

Future<void> _pump(WidgetTester tester, _FakeFullBackupService service) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [fullBackupServiceProvider.overrideWithValue(service)],
      child: wrapWithApp(
        child: const Scaffold(body: SingleChildScrollView(child: FullBackupSection())),
      ),
    ),
  );
}

void main() {
  testWidgets(
    'a failed load ends in an error and a retry button, not an endless bar',
    (tester) async {
      final service = _FakeFullBackupService()
        ..capabilitiesError = DioException(
          requestOptions: RequestOptions(path: '/backup/full/capabilities'),
          response: Response(
            requestOptions: RequestOptions(path: '/backup/full/capabilities'),
            statusCode: 403,
            data: const {'detail': 'Only the program administrator can do this.'},
          ),
          type: DioExceptionType.badResponse,
        );

      await _pump(tester, service);
      await tester.pumpAndSettle();

      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.textContaining('program administrator'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Refresh status'), findsOneWidget);
    },
  );

  testWidgets('creating a backup shows progress while running and the file name after', (
    tester,
  ) async {
    final service = _FakeFullBackupService()
      ..createGate = Completer<Map<String, dynamic>>();
    service.filesAfterCreate = const [
      {'name': 'kayan-full-test.dump', 'kind': 'full', 'sizeBytes': 2048},
    ];

    await _pump(tester, service);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Create full backup'));
    await tester.pump();
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.text('Creating the backup…'), findsOneWidget);

    service.createGate!.complete(const {
      'file': {'name': 'kayan-full-test.dump'},
    });
    await tester.pumpAndSettle();

    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.textContaining('kayan-full-test.dump'), findsWidgets);
  });

  testWidgets(
    'a create request that errors after the server finished still reports the new file',
    (tester) async {
      final service = _FakeFullBackupService()
        ..createError = DioException(
          requestOptions: RequestOptions(path: '/backup/full'),
          type: DioExceptionType.receiveTimeout,
        );
      service.filesAfterCreate = const [
        {'name': 'kayan-full-late.dump', 'kind': 'full', 'sizeBytes': 1024},
      ];

      await _pump(tester, service);
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilledButton, 'Create full backup'));
      await tester.pumpAndSettle();

      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.textContaining('kayan-full-late.dump'), findsWidgets);
      expect(find.textContaining('Saved successfully'), findsWidgets);
    },
  );

  testWidgets('a create that truly fails ends busy with a visible error', (
    tester,
  ) async {
    final service = _FakeFullBackupService()
      ..createError = DioException(
        requestOptions: RequestOptions(path: '/backup/full'),
        response: Response(
          requestOptions: RequestOptions(path: '/backup/full'),
          statusCode: 503,
          data: const {'detail': 'The backup could not be created.'},
        ),
        type: DioExceptionType.badResponse,
      );

    await _pump(tester, service);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Create full backup'));
    await tester.pumpAndSettle();

    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.textContaining('could not be created'), findsOneWidget);
    // The button is usable again: busy was reset.
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Create full backup'),
    );
    expect(button.onPressed, isNotNull);
  });
}
