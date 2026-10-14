import 'dart:convert';
import 'dart:io';

import 'package:erp_kayan/core/backend/backend_gate.dart';
import 'package:erp_kayan/core/backend/local_backend.dart';
import 'package:erp_kayan/core/backend/local_backend_io.dart' as io;
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    as data;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  tearDown(() {
    debugOwnsItsBackendOverride = null;
    debugEnsureRunningOverride = null;
    debugCreateFirstAdministratorOverride = null;
  });

  testWidgets(
    'BackendGate shows first-administrator setup when database is empty instead of opening LoginScreen with no server',
    (tester) async {
      debugOwnsItsBackendOverride = true;
      debugEnsureRunningOverride = ({required String appDisplayName}) async =>
          const LocalBackendStatus.needsFirstAdministrator();

      await tester.pumpWidget(
        const BackendGate(
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: Text('LOGIN_SCREEN_PLACEHOLDER'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('أول تشغيل على الجهاز ده'), findsOneWidget);
      expect(find.text('LOGIN_SCREEN_PLACEHOLDER'), findsNothing);
    },
  );

  testWidgets(
    'BackendGate injects local server baseUrl into both auth apiClientProvider and data appConfigProvider',
    (tester) async {
      const dynamicBaseUrl = 'http://127.0.0.1:3010/api/v1';
      debugOwnsItsBackendOverride = true;
      debugEnsureRunningOverride = ({required String appDisplayName}) async =>
          const LocalBackendStatus.ready(dynamicBaseUrl);

      String? authConfigUrl;
      String? dataConfigUrl;
      String? dioBaseUrl;

      await tester.pumpWidget(
        BackendGate(
          child: Consumer(
            builder: (context, ref, _) {
              authConfigUrl = ref.watch(appConfigProvider).apiBaseUrl;
              dataConfigUrl = ref.watch(data.appConfigProvider).apiBaseUrl;
              dioBaseUrl = ref.watch(apiClientProvider).raw.options.baseUrl;
              return MaterialApp(
                home: Scaffold(
                  body: Text('BASE:$dioBaseUrl'),
                ),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(authConfigUrl, equals(dynamicBaseUrl));
      expect(dataConfigUrl, equals(dynamicBaseUrl));
      expect(dioBaseUrl, equals(dynamicBaseUrl));
      expect(find.text('BASE:$dynamicBaseUrl'), findsOneWidget);
    },
  );

  test(
    'authControllerProvider signs in against dynamic local server port via overridden appConfigProvider',
    () async {
      HttpOverrides.global = null;
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));

      final requestedPaths = <String>[];
      Map<String, dynamic>? receivedLoginBody;

      server.listen((HttpRequest request) async {
        requestedPaths.add('${request.method} ${request.uri.path}');
        request.response.headers.contentType = ContentType.json;

        if (request.uri.path == '/api/v1/auth/login' &&
            request.method == 'POST') {
          final raw = await utf8.decoder.bind(request).join();
          receivedLoginBody = jsonDecode(raw) as Map<String, dynamic>;
          request.response.statusCode = HttpStatus.ok;
          request.response.write(
            jsonEncode({
              'accessToken': 'test-access-token',
              'refreshToken': 'test-refresh-token',
              'user': {
                'id': 'u-1',
                'username': receivedLoginBody!['username'],
                'fullName': 'مدير النظام',
                'companyId': 'c-1',
                'branchId': 'b-1',
                'roles': ['ADMIN'],
                'permissions': <String>[],
                'isActive': true,
                'isSuperAdmin': true,
              },
            }),
          );
        } else {
          request.response.statusCode = HttpStatus.ok;
          request.response.write(jsonEncode(<String, dynamic>{}));
        }
        await request.response.close();
      });

      final baseUrl = 'http://127.0.0.1:${server.port}/api/v1';
      final container = ProviderContainer(
        overrides: [
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer(baseUrl),
          ),
        ],
      );
      addTearDown(container.dispose);

      final result = await container
          .read(authControllerProvider.notifier)
          .signIn(username: 'admin', password: 'AdminPassword123');

      expect(result.isSuccess, isTrue);
      expect(result.valueOrNull?.username, equals('admin'));
      expect(receivedLoginBody?['username'], equals('admin'));
      expect(requestedPaths, contains('POST /api/v1/auth/login'));
    },
  );

  test(
    'RuntimeSettings.load strips UTF-8 BOM, preserves DATABASE_URL, and populates missing JWT secrets',
    () async {
      final tempDir = await Directory.systemTemp.createTemp('kayan_settings_');
      addTearDown(() => tempDir.delete(recursive: true));

      final envFile = File(
        '${tempDir.path}${Platform.pathSeparator}kayan.env',
      );
      const customDbUrl =
          'postgresql://erp_app:SecretPass123@127.0.0.1:5433/erp_kayan?schema=public';
      await envFile.writeAsString(
        '\uFEFF# Legacy env with BOM\n'
        'DATABASE_URL="$customDbUrl"\n'
        'JWT_SECRET="legacy-jwt-secret-value"\n',
      );

      final layout = io.BackendLayout(
        backendDirectory: tempDir.path,
        nodeExecutable: 'node',
        entryPoint: '${tempDir.path}${Platform.pathSeparator}main.js',
        dataDirectory: tempDir,
        logPath: '${tempDir.path}${Platform.pathSeparator}backend.log',
      );

      final settings = await io.RuntimeSettings.load(layout, 3001);
      final env = settings.asEnvironment(3001);

      expect(env['DATABASE_URL'], equals(customDbUrl));
      expect(env['PORT'], equals('3001'));
      expect(env['JWT_ACCESS_SECRET'], equals('legacy-jwt-secret-value'));
      expect(env['JWT_REFRESH_SECRET'], isNotNull);
      expect(env['JWT_REFRESH_SECRET'], isNotEmpty);
    },
  );
}
