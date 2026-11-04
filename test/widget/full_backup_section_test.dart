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
  bool deletionProtected = false;
  Completer<Map<String, dynamic>>? createGate;
  Object? createError;
  Map<String, dynamic>? createResult;
  List<Map<String, dynamic>> files = const [];
  List<Map<String, dynamic>> filesAfterCreate = const [];
  bool createCalled = false;

  @override
  Future<Map<String, dynamic>> capabilities() async {
    final error = capabilitiesError;
    if (error != null) throw error;
    return {'available': true, 'deletionProtected': deletionProtected};
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
    return createResult ?? const {
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
      expect(find.text('You do not have permission to do this.'), findsOneWidget);
      expect(find.textContaining('program administrator'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Refresh status'), findsOneWidget);
      // The reported bug: this state used to leave «Refresh status» as the
      // only button in the section. The create action itself must be on
      // the screen next to it.
      expect(
        find.widgetWithText(FilledButton, 'Create backup now'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'the create button stays usable when the capabilities load failed',
    (tester) async {
      final service = _FakeFullBackupService()
        ..capabilitiesError = DioException(
          requestOptions: RequestOptions(path: '/backup/full/capabilities'),
          type: DioExceptionType.connectionError,
        );
      service.filesAfterCreate = const [
        {'name': 'kayan-full-test.dump', 'kind': 'full', 'sizeBytes': 2048},
      ];

      await _pump(tester, service);
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
      await tester.pumpAndSettle();

      expect(service.createCalled, isTrue);
      expect(find.textContaining('kayan-full-test.dump'), findsWidgets);
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

    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
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
    'a timeout does not claim a concurrently created file as this request',
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

      await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
      await tester.pumpAndSettle();

      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.textContaining('kayan-full-late.dump'), findsWidgets);
      expect(find.textContaining('Saved successfully'), findsNothing);
      expect(find.textContaining('outcome could not be confirmed'), findsOneWidget);
    },
  );

  testWidgets('protected backups show why deletion is unavailable', (tester) async {
    final service = _FakeFullBackupService()
      ..deletionProtected = true
      ..files = const [
        {'name': 'old.dump', 'kind': 'full', 'sizeBytes': 1024},
      ];
    await _pump(tester, service);
    await tester.pumpAndSettle();
    expect(find.textContaining('Deletion is paused'), findsOneWidget);
    final deleteButton = find.ancestor(
      of: find.byIcon(Icons.delete_outline, skipOffstage: false),
      matching: find.byType(IconButton, skipOffstage: false),
    );
    expect(deleteButton, findsOneWidget);
    expect(tester.widget<IconButton>(deleteButton).onPressed, isNull);
  });

  testWidgets('a success response without a file is not reported as saved', (tester) async {
    final service = _FakeFullBackupService()..createResult = {};
    await _pump(tester, service);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Saved successfully'), findsNothing);
    expect(find.textContaining('outcome could not be confirmed'), findsOneWidget);
  });

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

    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
    await tester.pumpAndSettle();

    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.textContaining('The server failed while handling the request'), findsOneWidget);
    expect(find.textContaining('The request outcome could not be confirmed'), findsOneWidget);
    expect(find.textContaining('The backup could not be created'), findsNothing);
    // The button is usable again: busy was reset.
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Create backup now'),
    );
    expect(button.onPressed, isNotNull);
  });
}
