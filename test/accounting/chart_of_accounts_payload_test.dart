import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/accounting/data/datasources/chart_of_accounts_data_source.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:flutter_test/flutter_test.dart';

/// Regression every deactivation failed against.
///
/// `PATCH /accounting/chart-of-accounts/:id` accepts code, nameEn, nameAr,
/// parentId, isPostable, isActive, currency and description — and nothing
/// else. `AccountInput.toJson()` used to add the account *type* to that body,
/// which the global validation pipe (whitelist + forbidNonWhitelisted)
/// rejected wholesale:
///
///     400 {"detail": "property type should not exist"}
///
/// So turning an account off, and saving any edit, answered with an error.
/// These tests pin the wire format down: creation still sends the type,
/// an update never does, and a status change carries the flag alone.
class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter();

  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    final body = _bodyOf(options);
    return ResponseBody.fromString(
      jsonEncode({
        'id': 'a1',
        'companyId': 'c1',
        'code': '1104',
        'nameEn': 'Inventory',
        'nameAr': 'المخزون',
        'type': 'ASSET',
        'isPostable': body['isActive'] != false,
        'isActive': body['isActive'] ?? true,
      }),
      200,
      headers: const {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _MemoryTokenBackend implements SecureTokenBackend {
  String? _access;
  String? _refresh;

  @override
  Future<void> write(String key, String value) async {
    if (key.contains('access')) _access = value;
    if (key.contains('refresh')) _refresh = value;
  }

  @override
  Future<String?> read(String key) async =>
      key.contains('access') ? _access : _refresh;

  @override
  Future<void> delete(String key) async {
    if (key.contains('access')) _access = null;
    if (key.contains('refresh')) _refresh = null;
  }
}

_RemoteFixture _fixture() {
  final adapter = _RecordingAdapter();
  final dio = Dio(
    BaseOptions(
      baseUrl: 'http://127.0.0.1:3000/api/v1',
      validateStatus: (status) => status != null && status < 400,
    ),
  )..httpClientAdapter = adapter;
  final client = ApiClient(
    const AppConfig(
      environment: AppEnvironment.development,
      apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
      connectTimeout: Duration(seconds: 5),
      receiveTimeout: Duration(seconds: 5),
    ),
    TokenStore(backend: _MemoryTokenBackend()),
    dio: dio,
  );
  return _RemoteFixture(adapter, RemoteChartOfAccountsDataSource(client));
}

/// Dio may hand the adapter either the original map or its serialised form,
/// depending on the transformer; the assertion should not care which.
Map<String, dynamic> _bodyOf(RequestOptions options) {
  final data = options.data;
  if (data is Map) return Map<String, dynamic>.from(data);
  if (data is String && data.isNotEmpty) {
    final decoded = jsonDecode(data);
    if (decoded is Map) return Map<String, dynamic>.from(decoded);
  }
  return <String, dynamic>{};
}

class _RemoteFixture {
  const _RemoteFixture(this.adapter, this.source);

  final _RecordingAdapter adapter;
  final RemoteChartOfAccountsDataSource source;
}

const _input = AccountInput(
  code: '1104',
  nameEn: 'Inventory',
  nameAr: 'المخزون',
  type: AccountType.asset,
  parentId: 'p1',
  isPostable: true,
  isActive: true,
  description: 'Stock on hand',
);

/// What `UpdateAccountDto` on the server declares. Anything else in a PATCH
/// body is refused with `property <name> should not exist`.
const _updateContract = {
  'code',
  'nameEn',
  'nameAr',
  'parentId',
  'isPostable',
  'isActive',
  'currency',
  'description',
};

void main() {
  group('AccountInput payloads', () {
    test('creation states the type', () {
      expect(_input.toCreateJson()['type'], 'ASSET');
    });

    test('an update never sends the type', () {
      expect(_input.toUpdateJson().containsKey('type'), isFalse);
    });

    test('an update only sends fields the server accepts', () {
      expect(
        _input.toUpdateJson().keys.toSet().difference(_updateContract),
        isEmpty,
      );
    });

    test('a code is only sent when there is one', () {
      const withoutCode = AccountInput(
        nameEn: 'Bank',
        nameAr: 'البنك',
        type: AccountType.asset,
      );
      expect(withoutCode.toUpdateJson().containsKey('code'), isFalse);
    });
  });

  group('RemoteChartOfAccountsDataSource', () {
    test('deactivation sends only the flag', () async {
      final f = _fixture();

      await f.source.setActive('a1', isActive: false);

      expect(f.adapter.calls, hasLength(1));
      final call = f.adapter.calls.single;
      expect(call.method, 'PATCH');
      expect(call.path, '/accounting/chart-of-accounts/a1');
      expect(_bodyOf(call), {'isActive': false});
      expect(_bodyOf(call).containsKey('type'), isFalse);
    });

    test('reactivation sends only the flag', () async {
      final f = _fixture();

      await f.source.setActive('a1', isActive: true);

      expect(_bodyOf(f.adapter.calls.single), {'isActive': true});
    });

    test('an edit sends no type and stays inside the update contract',
        () async {
      final f = _fixture();

      await f.source.updateAccount('a1', _input);

      final data = _bodyOf(f.adapter.calls.single);
      expect(data.containsKey('type'), isFalse);
      expect(data.keys.toSet().difference(_updateContract), isEmpty);
      expect(data['nameEn'], 'Inventory');
    });

    test('creation sends the type the server needs', () async {
      final f = _fixture();

      await f.source.createAccount(_input);

      final call = f.adapter.calls.single;
      expect(call.method, 'POST');
      expect(_bodyOf(call)['type'], 'ASSET');
    });
  });
}
