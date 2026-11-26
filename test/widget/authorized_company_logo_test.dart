import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/shared/widgets/authorized_company_logo.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

final _red = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==');
final _blue = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGNgYPiPhIjiAACOsw/xs6MvMwAAAABJRU5ErkJggg==');

/// A server for the mark: it needs the session, renews an expired one through
/// /auth/refresh, and answers with the mark of the company the session
/// belongs to (red for company A, blue for company B).
class _LogoServer implements HttpClientAdapter {
  final authorizations = <String?>[];
  final paths = <String>[];
  String validToken = 'access-1';
  bool expireFirst = false;
  bool missing = false;
  List<int> body = _red;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    paths.add(options.path);
    if (options.path.endsWith('/auth/refresh')) {
      validToken = 'access-2';
      return ResponseBody.fromString(
        '{"accessToken":"access-2","refreshToken":"refresh-2"}',
        200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
      );
    }
    final header = options.headers['Authorization'] as String?;
    authorizations.add(header);
    if (missing) return ResponseBody.fromString('{}', 404);
    if (expireFirst) {
      expireFirst = false;
      return ResponseBody.fromString('{}', 401,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    }
    if (header != 'Bearer $validToken') {
      return ResponseBody.fromString('{}', 401,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    }
    return ResponseBody.fromBytes(body, 200,
        headers: {Headers.contentTypeHeader: ['image/png']});
  }

  @override
  void close({bool force = false}) {}
}

AppUser _user(String id, String company) => AppUser(
      id: id,
      username: id,
      fullName: id,
      companyId: company,
      branchId: 'b',
    );

class _SignedIn extends Notifier<AppUser?> {
  @override
  AppUser? build() => null;
  void set(AppUser? user) => state = user;
}

final _signedIn = NotifierProvider<_SignedIn, AppUser?>(_SignedIn.new);

Future<(ProviderContainer, _LogoServer, FakeTokenStore, GlobalKey)> _pump(
  WidgetTester tester, {
  AppUser? user,
  String? url = 'http://127.0.0.1:3000/api/v1/companies/logo/company-a',
  void Function(_LogoServer server)? setup,
}) async {
  final server = _LogoServer();
  setup?.call(server);
  final store = FakeTokenStore()
    ..accessToken = 'access-1'
    ..refreshToken = 'refresh-1';
  final dio = Dio(BaseOptions(
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    responseType: ResponseType.json,
    validateStatus: (status) => status != null && status < 400,
  ))
    ..httpClientAdapter = server;
  final client = ApiClient(
    const AppConfig(
      environment: AppEnvironment.development,
      apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
      connectTimeout: Duration(seconds: 5),
      receiveTimeout: Duration(seconds: 5),
    ),
    store,
    dio: dio,
  );
  final key = GlobalKey();
  final container = ProviderContainer(overrides: [
    apiClientProvider.overrideWithValue(client),
    currentUserProvider.overrideWith((ref) => ref.watch(_signedIn)),
  ]);
  addTearDown(container.dispose);
  container.read(_signedIn.notifier).set(user ?? _user('a-user', 'company-a'));
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      home: Scaffold(
        body: Center(
          child: RepaintBoundary(
            key: key,
            child: SizedBox(
              width: 40,
              height: 40,
              child: AuthorizedCompanyLogo(
                url: url,
                width: 40,
                height: 40,
                fit: BoxFit.fill,
                fallback: const Icon(Icons.business, key: ValueKey('fallback')),
              ),
            ),
          ),
        ),
      ),
    ),
  ));
  return (container, server, store, key);
}

/// The colour of the middle of what is actually drawn, read back from pixels.
Future<List<int>> _centrePixel(WidgetTester tester, GlobalKey key) async {
  return (await tester.runAsync(() async {
    final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage();
    final data = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
    final x = image.width ~/ 2, y = image.height ~/ 2;
    final o = (y * image.width + x) * 4;
    return [data.getUint8(o), data.getUint8(o + 1), data.getUint8(o + 2)];
  }))!;
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  testWidgets('draws the mark fetched with the session (pixels checked)', (tester) async {
    final (_, server, _, key) = await _pump(tester);
    await _settle(tester);
    expect(server.authorizations, ['Bearer access-1']);
    expect(find.byKey(const ValueKey('fallback')), findsNothing);
    final c = await _centrePixel(tester, key);
    expect(c, [255, 0, 0]);
  });

  testWidgets('an expired session is renewed once and the mark is still drawn', (tester) async {
    final (_, server, _, key) = await _pump(tester, setup: (s) => s.expireFirst = true);
    await _settle(tester);
    expect(server.paths.where((p) => p.endsWith('/auth/refresh')), hasLength(1));
    expect(server.authorizations, ['Bearer access-1', 'Bearer access-2']);
    final c = await _centrePixel(tester, key);
    expect(c, [255, 0, 0]);
  });

  testWidgets('a missing mark shows the fallback, not an error', (tester) async {
    await _pump(tester, setup: (s) => s.missing = true);
    await _settle(tester);
    expect(find.byKey(const ValueKey('fallback')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no address means no request and the fallback', (tester) async {
    final (_, server, _, _) = await _pump(tester, url: null);
    await _settle(tester);
    expect(server.paths, isEmpty);
    expect(find.byKey(const ValueKey('fallback')), findsOneWidget);
  });

  testWidgets('another person signing in never sees the earlier person\'s mark', (tester) async {
    final (container, server, _, key) = await _pump(tester);
    await _settle(tester);
    var c = await _centrePixel(tester, key);
    expect(c, [255, 0, 0]);

    // Same address, someone from another company signs in: the mark is
    // fetched again and is the other company's.
    server.body = _blue;
    container.read(_signedIn.notifier).set(_user('b-user', 'company-b'));
    await _settle(tester);
    expect(server.authorizations, hasLength(2));
    c = await _centrePixel(tester, key);
    expect(c, [0, 0, 255]);

    // Signing out drops it: with nobody signed in and the server refusing,
    // the fallback shows and no bytes from either company remain.
    server.missing = true;
    container.read(_signedIn.notifier).set(null);
    await _settle(tester);
    expect(find.byKey(const ValueKey('fallback')), findsOneWidget);
  });
}
