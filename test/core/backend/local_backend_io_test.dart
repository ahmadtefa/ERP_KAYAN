import 'dart:io';

import 'package:erp_kayan/core/backend/local_backend_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('KayanDatabaseConfig', () {
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
