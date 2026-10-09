import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:flutter_test/flutter_test.dart';

/// Sends a file the way the import screen sends it.
///
/// The point is the request itself: the same `DataService.import` the button
/// calls, with the same FormData and the same bytes. Reading a file the user
/// chose needs a browser, but everything after that does not, so this is where
/// the upload can be checked on its own.
///
/// It talks to a running server. When there is not one, the test says so and
/// passes rather than failing: a developer without the API started should not
/// see a red suite.
const baseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000/api/v1',
);

Future<bool> reachable() async {
  try {
    final dio = Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 3)));
    final response = await dio.get<dynamic>('/health');
    return response.statusCode == 200;
  } catch (_) {
    return false;
  }
}

void main() {
  late Dio dio;

  setUp(() {
    dio = Dio(BaseOptions(baseUrl: baseUrl));
  });

  test('uploads a spreadsheet and reads the answer', () async {
    if (!await reachable()) {
      // ignore: avoid_print
      print('skipped: no server at $baseUrl');
      return;
    }

    final login = await dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'username': 'admin', 'password': 'Admin@12345'},
    );
    final token = login.data?['accessToken'] as String?;
    expect(token, isNotNull, reason: 'the seed administrator should sign in');
    dio.options.headers['Authorization'] = 'Bearer $token';

    final stamp = DateTime.now().millisecondsSinceEpoch.toString().substring(5);
    final csv = 'code,name_ar,name_en\nUC-$stamp,عميل من الاختبار,Upload Test\n';

    final service = DataService(dio);

    // First the dry run: it must report the row and write nothing.
    final report = await service.import(
      kind: ImportKind.customers,
      file: PickedFile(
        name: 'from-test.csv',
        bytes: Uint8List.fromList(utf8.encode(csv)),
        mimeType: 'text/csv',
      ),
      mode: ImportMode.insert,
      dryRun: true,
    );

    expect(report.dryRun, isTrue);
    expect(report.totalRows, 1);
    expect(report.created, 1, reason: 'the row is new, so it would be added');
    expect(report.errors, isEmpty);

    final list = await dio.get<Map<String, dynamic>>(
      '/parties/customers',
      queryParameters: {'q': 'UC-$stamp'},
    );
    expect(
      (list.data?['items'] as List?)?.length ?? -1,
      0,
      reason: 'a dry run must not write anything',
    );

    // Then for real.
    final committed = await service.import(
      kind: ImportKind.customers,
      file: PickedFile(
        name: 'from-test.csv',
        bytes: Uint8List.fromList(utf8.encode(csv)),
        mimeType: 'text/csv',
      ),
      mode: ImportMode.insert,
      dryRun: false,
    );
    expect(committed.dryRun, isFalse);
    expect(committed.created, 1);

    final after = await dio.get<Map<String, dynamic>>(
      '/parties/customers',
      queryParameters: {'q': 'UC-$stamp'},
    );
    expect((after.data?['items'] as List?)?.length, 1);

    // Uploading the same file again must change nothing.
    final again = await service.import(
      kind: ImportKind.customers,
      file: PickedFile(
        name: 'from-test.csv',
        bytes: Uint8List.fromList(utf8.encode(csv)),
        mimeType: 'text/csv',
      ),
      mode: ImportMode.insert,
      dryRun: false,
    );
    expect(again.created, 0);
    expect(again.skipped, 1);
  }, timeout: const Timeout(Duration(seconds: 60)));

  test('a file the server cannot use comes back as a readable reason', () async {
    if (!await reachable()) {
      // ignore: avoid_print
      print('skipped: no server at $baseUrl');
      return;
    }

    final login = await dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'username': 'admin', 'password': 'Admin@12345'},
    );
    dio.options.headers['Authorization'] = 'Bearer ${login.data?['accessToken']}';

    final service = DataService(dio);

    await expectLater(
      () => service.import(
        kind: ImportKind.customers,
        file: PickedFile(
          name: 'not-a-sheet.png',
          bytes: Uint8List.fromList(List<int>.filled(300, 7)),
          mimeType: 'image/png',
        ),
        mode: ImportMode.insert,
        dryRun: true,
      ),
      throwsA(
        isA<DioException>().having(
          (error) => error.response?.statusCode,
          'status',
          400,
        ),
      ),
    );
  }, timeout: const Timeout(Duration(seconds: 60)));
}
