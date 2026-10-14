import 'package:erp_kayan/core/backend/local_backend_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('KayanDatabaseConfig', () {
    test('matches the PostgreSQL port provisioned by the Windows scripts', () {
      expect(KayanDatabaseConfig.port, 5433);
    });

    test('encodes application database credentials in its URL', () {
      final url = KayanDatabaseConfig.buildDatabaseUrl(
        username: 'erp@app',
        password: 'p@ss:/?#',
      );

      expect(
        url,
        'postgresql://erp%40app:p%40ss%3A%2F%3F%23@127.0.0.1:5433/erp_kayan?schema=public',
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
        isTrue,
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
}
