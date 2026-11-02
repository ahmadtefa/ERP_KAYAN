import 'dart:io';

import 'package:erp_kayan/core/backend/local_backend_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('damaged-licence diagnostics', () {
    test('keeps only an enforced and healthy database server for diagnostics', () {
      final health = <String, dynamic>{
        'status': 'ok',
        'database': 'up',
        'license': {
          'enforcement': 'enforce',
          'configured': false,
          'stateError': 'LICENSE_STATE_DAMAGED',
        },
      };
      expect(keepServerForLicenceDiagnostics(health), isTrue);
      expect(keepServerForLicenceDiagnostics(null), isFalse);
      expect(keepServerForLicenceDiagnostics({...health, 'database': 'down'}), isFalse);
      expect(keepServerForLicenceDiagnostics({...health, 'status': 'degraded'}), isFalse);
      expect(
        keepServerForLicenceDiagnostics({
          ...health,
          'license': {'enforcement': 'warn', 'stateError': 'LICENSE_STATE_DAMAGED'},
        }),
        isFalse,
      );
      expect(
        keepServerForLicenceDiagnostics({
          ...health,
          'license': {'enforcement': 'enforce', 'configured': true},
        }),
        isFalse,
      );
    });
  });

  group('a server whose licence key is unusable', () {
    Map<String, dynamic> health({
      Object? enforcement = 'enforce',
      Object? configured = false,
      String? stateError,
      String databaseName = 'erp_kayan',
    }) {
      final licence = <String, dynamic>{
        'enforcement': enforcement,
        'configured': configured,
      };
      if (stateError != null) licence['stateError'] = stateError;
      return <String, dynamic>{
        'status': 'ok',
        'database': 'up',
        'databaseName': databaseName,
        'license': licence,
      };
    }

    test('is opened, not refused, when the server enforces without a key', () {
      // The program used to stop here. It must not: the server refuses every
      // business route by itself, and closing the window also closes the only
      // screen that explains how to put the key back.
      expect(
        serverIdentityProblem(
          health: health(),
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: true,
        ),
        isNull,
      );
      expect(licenceKeyWarning(health()), isNotNull);
      expect(licenceKeyWarning(health(configured: true)), isNull);
      expect(licenceKeyWarning(health(enforcement: 'warn')), isNull);
      expect(licenceKeyWarning(null), isNull);
    });

    test('is still refused when the server would serve data without a licence', () {
      // A copy started by hand with LICENSE_ENFORCEMENT=warn is the one way
      // round the licence, and it stays refused.
      expect(
        serverIdentityProblem(
          health: health(enforcement: 'warn', configured: true),
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: true,
        ),
        isNotNull,
      );
      expect(
        serverIdentityProblem(
          health: health(enforcement: 'off', configured: true),
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: true,
        ),
        isNotNull,
      );
      // The same server is fine for a build that does not require a licence.
      expect(
        serverIdentityProblem(
          health: health(enforcement: 'warn', configured: true),
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: false,
        ),
        isNull,
      );
    });

    test('keeps refusing a damaged trust state and a foreign database', () {
      expect(
        serverIdentityProblem(
          health: health(
            configured: true,
            stateError: 'LICENSE_STATE_DAMAGED',
          ),
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: true,
        ),
        isNotNull,
      );
      expect(
        serverIdentityProblem(
          health: health(configured: true, databaseName: 'erp_kayan_20260101'),
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: true,
        ),
        isNotNull,
      );
      expect(
        serverIdentityProblem(
          health: null,
          expectedDatabaseName: 'erp_kayan',
          licenceRequired: true,
        ),
        isNotNull,
      );
    });

    test('carries a readable warning with a ready status', () {
      const warning = 'the key is missing';
      const ready = LocalBackendStatus.ready(
        'http://127.0.0.1:3000/api/v1',
        licenceWarning: warning,
      );
      expect(ready.isReady, isTrue);
      expect(ready.problem, isNull);
      expect(ready.licenceWarning, warning);
      const plain = LocalBackendStatus.ready('http://127.0.0.1:3000/api/v1');
      expect(plain.licenceWarning, isNull);
      const failed = LocalBackendStatus.failed('no server');
      expect(failed.licenceWarning, isNull);
      expect(failed.isReady, isFalse);
    });
  });

  group('KayanDatabaseConfig', () {
    test('recovery requires both matching database identities', () {
      const url = 'postgresql://erp_app:password@127.0.0.1:5432/erp_kayan';
      expect(KayanDatabaseConfig.hasMatchingDatabaseIdentity(url, 'erp_kayan'), isTrue);
      expect(KayanDatabaseConfig.hasMatchingDatabaseIdentity(url, 'other'), isFalse);
      expect(KayanDatabaseConfig.hasMatchingDatabaseIdentity(url, null), isFalse);
      expect(KayanDatabaseConfig.hasMatchingDatabaseIdentity(null, 'erp_kayan'), isFalse);
      expect(KayanDatabaseConfig.hasMatchingDatabaseIdentity('postgresql://localhost/', ''), isFalse);
    });
    test('matches the PostgreSQL port the Windows installer provisions', () {
      // The shipped Setup puts the bundled cluster on 5432. It used to be 5433
      // here - the port of the older development cluster - so a copy without a
      // readable settings file went looking for a database the installer never
      // creates, and could find a previous installation's company instead.
      expect(KayanDatabaseConfig.port, 5432);
    });

    test('encodes application database credentials in its URL', () {
      final url = KayanDatabaseConfig.buildDatabaseUrl(
        username: 'erp@app',
        password: 'p@ss:/?#',
      );

      expect(
        url,
        'postgresql://erp%40app:p%40ss%3A%2F%3F%23@127.0.0.1:5432/erp_kayan?schema=public',
      );
      final uri = Uri.parse(url);
      expect(uri.host, KayanDatabaseConfig.host);
      expect(uri.port, KayanDatabaseConfig.port);
      expect(uri.pathSegments.first, KayanDatabaseConfig.databaseName);
    });

    test('recognizes only the configured local database endpoint', () {
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@127.0.0.1:5433/erp_kayan?schema=public',
        ),
        isFalse,
      );
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@127.0.0.1:5432/erp_kayan',
        ),
        isTrue,
      );
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@127.0.0.1:5434/erp_kayan',
        ),
        isFalse,
      );
      expect(KayanDatabaseConfig.isLocalDatabaseUrl(null), isFalse);
    });

    test('accepts the new-company database this product itself creates', () {
      // A new company (or a safe reset) gets erp_kayan_<timestamp> on the same
      // cluster. Refusing it here would call the installation's own database a
      // foreign one - the mistake that made "a new company" fail at the end of
      // Setup.
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@127.0.0.1:5432/'
          'erp_kayan_20261027120000?schema=public',
        ),
        isTrue,
      );
      // Still anchored: another role, another name, another server.
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://postgres:secret@127.0.0.1:5432/'
          'erp_kayan_20261027120000?schema=public',
        ),
        isFalse,
      );
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@127.0.0.1:5432/erp_kayan_other',
        ),
        isFalse,
      );
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@127.0.0.1:5432/erp_kayan_2026102712000',
        ),
        isFalse,
      );
      expect(
        KayanDatabaseConfig.isLocalDatabaseUrl(
          'postgresql://erp_app:secret@192.168.1.5:5432/erp_kayan',
        ),
        isFalse,
      );
    });

    test('reads the database name out of a connection string', () {
      expect(
        KayanDatabaseConfig.databaseNameFromUrl(
          'postgresql://erp_app:secret@127.0.0.1:5432/erp_kayan_20261027120000'
          '?schema=public',
        ),
        'erp_kayan_20261027120000',
      );
      expect(KayanDatabaseConfig.databaseNameFromUrl(null), isNull);
      expect(KayanDatabaseConfig.databaseNameFromUrl(''), isNull);
      expect(
        KayanDatabaseConfig.databaseNameFromUrl('postgresql://host:5432'),
        isNull,
      );
    });

    test('builds the admin URL on the same provisioned PostgreSQL port', () {
      final uri = Uri.parse(
        KayanDatabaseConfig.buildAdminDatabaseUrl(password: 'admin-secret'),
      );

      expect(uri.host, KayanDatabaseConfig.host);
      expect(uri.port, KayanDatabaseConfig.port);
      expect(uri.pathSegments.single, KayanDatabaseConfig.adminDatabaseName);
    });

    test(
      'credential failure guidance names both editable connection settings',
      () {
        final message = KayanDatabaseConfig.startupFailureMessage(
          serviceExists: true,
          authenticationOk: false,
          settingsPath: r'C:\Users\test\AppData\kayan.env',
          errorCode: 'Prisma P1000',
        );

        expect(message, contains('DATABASE_URL'));
        expect(message, contains('ADMIN_DATABASE_URL'));
        expect(message, contains('Prisma P1000'));
        expect(message, contains(r'C:\Users\test\AppData\kayan.env'));
      },
    );
  });

  group('the installer settings stamp', () {
    late Directory folder;

    setUp(() {
      folder = Directory.systemTemp.createTempSync('kayan-settings-test');
    });

    tearDown(() {
      folder.deleteSync(recursive: true);
    });

    test('is read from a settings file written by the installer', () {
      final file = File('${folder.path}${Platform.pathSeparator}kayan.env');
      file.writeAsStringSync(
        'DATABASE_URL="postgresql://erp_app:secret@127.0.0.1:5432/'
        'erp_kayan?schema=public"\nKAYAN_SETTINGS_GENERATION="1761600000"\n',
      );
      expect(BackendLayout.readSettingsGeneration(file), 1761600000);
    });

    test('is absent in a file the program wrote for itself', () {
      final file = File('${folder.path}${Platform.pathSeparator}kayan.env');
      file.writeAsStringSync('HOST=0.0.0.0\nDATABASE_URL="x"\n');
      expect(BackendLayout.readSettingsGeneration(file), isNull);
    });

    test('is absent when the file does not exist', () {
      expect(
        BackendLayout.readSettingsGeneration(
          File('${folder.path}${Platform.pathSeparator}missing.env'),
        ),
        isNull,
      );
    });
  });
}
