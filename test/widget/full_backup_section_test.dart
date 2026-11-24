import 'dart:typed_data';
import 'package:erp_kayan/core/platform/backup_save_target.dart';
import 'dart:async';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/core/app/app_scope_restart.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/features/data/presentation/widgets/full_backup_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
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
  bool? fullRestoreSupported;
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
    return {'available': true, 'deletionProtected': deletionProtected,
      if (fullRestoreSupported != null) 'fullRestoreSupported': fullRestoreSupported};
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
  Future<Uint8List> downloadBytes(String name) async => Uint8List.fromList([80, 71, 68, 77, 80, 1]);

  @override
  Future<Map<String, dynamic>> restore({
    PickedFile? file,
    String? fileName,
    required bool confirm,
  }) async => const {};
}

/// The complete-backup half of the section has its own service. Its answers
/// are what decide whether a restore control exists at all, so each test says
/// explicitly what this machine claims it can do.
class _FakeSystemBackupService extends SystemBackupService {
  _FakeSystemBackupService() : super(Dio());

  bool fullRestoreSupported = false;
  List<String> fullRestoreReasons = const [
    'the safety gate is not exercised in this test',
  ];
  Object? capabilitiesError;
  List<Map<String, dynamic>> files = const [];
  bool unfinished = false;
  bool recovered = false;

  @override
  Future<Map<String, dynamic>> capabilities() async {
    final error = capabilitiesError;
    if (error != null) throw error;
    return {
      'available': true,
      'fullRestoreSupported': fullRestoreSupported,
      'fullRestoreReasons': fullRestoreReasons,
      'backupDirectory': '/var/kayan/backups',
    };
  }

  @override
  Future<List<Map<String, dynamic>>> list() async => files;

  @override
  Future<Map<String, dynamic>> status() async => {
    'maintenance': unfinished,
    'journal': {'unfinished': unfinished, 'phase': 'db-replacing'},
  };

  @override
  Future<Map<String, dynamic>> resumeRecovery() async => {
    'recovered': recovered,
    'detail': recovered ? 'Recovered' : 'Not recovered',
  };

  @override
  Future<Map<String, dynamic>> restore({
    PickedFile? file,
    String? fileName,
    required bool confirm,
    String confirmPhrase = 'RESTORE',
  }) async => const {};
}

class _MemoryTokens implements SecureTokenBackend {
  final values = <String, String>{};
  @override
  Future<void> write(String key, String value) async { values[key] = value; }
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> delete(String key) async { values.remove(key); }
}

class _Target implements BackupSaveTarget {
  @override
  String get path => '/chosen/backup.dump';
  Uint8List? saved;
  Object? failure;
  @override
  Future<void> write(Uint8List bytes) async {
    if (failure != null) throw failure!;
    saved = bytes;
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeFullBackupService service, {
  _FakeSystemBackupService? system,
  TokenStore? tokenStore,
  Locale locale = const Locale('en'),
  Future<BackupSaveTarget?> Function()? choose,
}) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        fullBackupServiceProvider.overrideWithValue(service),
        backupSaveTargetProvider.overrideWithValue(choose ?? () async => _Target()),
        if (tokenStore != null) tokenStoreProvider.overrideWithValue(tokenStore),
        systemBackupServiceProvider.overrideWithValue(
          system ?? _FakeSystemBackupService(),
        ),
      ],
      child: wrapWithApp(
        locale: locale,
        child: const Scaffold(body: SingleChildScrollView(child: FullBackupSection())),
      ),
    ),
  );
}

void main() {
  testWidgets('web preserves explicit server archive and never claims chosen local save', (tester) async {
    final service = _FakeFullBackupService();
    var chooserCalled = false;
    await _pump(tester, service, choose: () async { chooserCalled = true; return _Target(); });
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create archive on server'));
    await tester.pumpAndSettle();
    expect(service.createCalled, isTrue);
    expect(chooserCalled, isFalse);
    expect(find.textContaining('Server copy only.'), findsOneWidget);
    expect(find.textContaining('Chosen file saved and verified'), findsNothing);
  }, skip: !kIsWeb);

  testWidgets('cancel Save As does not create or save a backup', (tester) async {
    final service = _FakeFullBackupService();
    await _pump(tester, service, choose: () async => null);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
    await tester.pumpAndSettle();
    expect(service.createCalled, isFalse);
    expect(find.textContaining('No backup was created'), findsOneWidget);
  });
  testWidgets('manual DUMP saves exact returned bytes only to chosen target', (tester) async {
    final service = _FakeFullBackupService();
    final target = _Target();
    await _pump(tester, service, choose: () async => target);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
    await tester.pumpAndSettle();
    expect(target.saved, [80, 71, 68, 77, 80, 1]);
    expect(find.textContaining('Chosen file saved and verified'), findsOneWidget);
    expect(find.textContaining('/chosen/backup.dump'), findsOneWidget);
  });
  testWidgets('write failure cannot claim chosen location saved or fallback', (tester) async {
    final service = _FakeFullBackupService();
    final target = _Target()..failure = StateError('write refused');
    await _pump(tester, service, choose: () async => target);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
    await tester.pumpAndSettle();
    expect(target.saved, isNull);
    expect(find.textContaining('Chosen file saved and verified'), findsNothing);
    expect(find.textContaining('The server copy remains'), findsOneWidget);
  });
  testWidgets('dialog failure cannot create a backup elsewhere', (tester) async {
    final service = _FakeFullBackupService();
    await _pump(tester, service, choose: () async => throw StateError('dialog unavailable'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create backup now'));
    await tester.pumpAndSettle();
    expect(service.createCalled, isFalse);
    expect(find.textContaining('Chosen file saved and verified'), findsNothing);
  });

  testWidgets('successful interrupted recovery clears credentials and restarts cached app state', (tester) async {
    final store = TokenStore(backend: _MemoryTokens());
    await store.saveTokens(accessToken: 'old-access', refreshToken: 'old-refresh');
    final system = _FakeSystemBackupService()..unfinished = true..recovered = true;
    final before = appScopeEpoch.value;
    await _pump(tester, _FakeFullBackupService(), system: system, tokenStore: store);
    await tester.pumpAndSettle();
    final button = find.text('Resume recovery from the safety backup');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start recovery'));
    await tester.pumpAndSettle();
    expect(await store.readAccessToken(), isNull);
    expect(await store.readRefreshToken(), isNull);
    expect(appScopeEpoch.value, before + 1);
  });

  for (final locale in [const Locale('en'), const Locale('ar')]) {
    for (final supported in [false, null]) {
      testWidgets('unverified restore options are hidden in ${locale.languageCode}, capability $supported', (tester) async {
        final service = _FakeFullBackupService()
          ..fullRestoreSupported = supported
          ..files = const [{'name': 'previous.dump', 'kind': 'full', 'sizeBytes': 20}];
        await _pump(tester, service, locale: locale);
        await tester.pumpAndSettle();
        expect(find.textContaining(locale.languageCode == 'ar'
            ? 'الاستعادة الكاملة متوقفة' : 'Full restore is paused'), findsOneWidget);
        expect(find.byIcon(Icons.restore, skipOffstage: false), findsNothing);
        expect(find.byIcon(Icons.download_outlined, skipOffstage: false), findsOneWidget);
        expect(find.byType(FilledButton), findsWidgets);
      });
    }
  }

  testWidgets('a gate that cannot be asked hides the restore it used to offer', (
    tester,
  ) async {
    final service = _FakeFullBackupService()
      ..files = const [{'name': 'previous.dump', 'kind': 'full', 'sizeBytes': 20}];
    final system = _FakeSystemBackupService()
      ..fullRestoreSupported = true
      ..files = const [
        {'name': 'kayan-2026-11-19.kayanbackup', 'kind': 'complete', 'sizeBytes': 4096},
      ];
    await _pump(tester, service, system: system);
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.restore), findsWidgets);

    // The machine stops answering the safety question: the restore control
    // must disappear rather than stay as a button that cannot succeed.
    system.capabilitiesError = DioException(
      requestOptions: RequestOptions(path: '/backup/complete/capabilities'),
      type: DioExceptionType.connectionError,
    );
    await tester.tap(find.widgetWithText(OutlinedButton, 'Refresh status'));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.restore, skipOffstage: false), findsNothing);
    expect(find.textContaining('Full restore is paused'), findsOneWidget);
  });

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

  for (final locale in [const Locale('en'), const Locale('ar')]) {
    testWidgets('database-only backup does not claim complete success in ${locale.languageCode}', (tester) async {
      final service = _FakeFullBackupService()..filesAfterCreate = const [
        {'name':'kayan-full-test.dump', 'kind':'full', 'sizeBytes':2048},
      ];
      await _pump(tester, service, locale: locale);
      await tester.pumpAndSettle();
      final label = locale.languageCode == 'ar' ? 'إنشاء نسخة احتياطية الآن' : 'Create backup now';
      await tester.tap(find.widgetWithText(FilledButton,label));
      await tester.pumpAndSettle();
      expect(find.textContaining(locale.languageCode == 'ar'
        ? 'لم تُحفظ الملفات الخارجية والترخيص' : 'External files and the licence are not included'),findsOneWidget);
      expect(find.textContaining(locale.languageCode == 'ar'
        ? 'أرشيف قاعدة البيانات فقط' : 'Database archive only'),findsWidgets);
      expect(find.textContaining(locale.languageCode == 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully'),findsNothing);
    });
  }

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
    expect(find.textContaining('paused on this machine'), findsOneWidget);
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

  testWidgets(
    'the section warns that a restore replaces every company, in both languages',
    (tester) async {
      for (final locale in [const Locale('en'), const Locale('ar')]) {
        await _pump(tester, _FakeFullBackupService(), locale: locale);
        await tester.pumpAndSettle();
        expect(
          find.textContaining(
            locale.languageCode == 'ar' ? 'جميع الشركات' : 'every company',
          ),
          findsWidgets,
        );
      }
    },
  );

  testWidgets(
    'the closure reasons are printed, not hidden behind a dead button',
    (tester) async {
      final system = _FakeSystemBackupService()
        ..fullRestoreSupported = false
        ..fullRestoreReasons = const ['postgresql-tools: pg_restore was not found'];
      await _pump(tester, _FakeFullBackupService(), system: system);
      await tester.pumpAndSettle();

      expect(find.textContaining('postgresql-tools'), findsOneWidget);
      expect(find.byIcon(Icons.restore, skipOffstage: false), findsNothing);
    },
  );
}
