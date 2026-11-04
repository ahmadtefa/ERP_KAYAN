import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// The embedded backend can choose a new loopback port after a restart. A
/// retry for the same local company must survive that port change; remote
/// installations stay isolated by origin and base path.
String orderRetryScope({required String apiBaseUrl, required String companyId,
  required String branchId, required String userId, required String kind, required String orderId}) {
  final base = Uri.parse(apiBaseUrl);
  final loopback = const {'localhost', '127.0.0.1', '::1'}.contains(base.host.toLowerCase());
  final server = loopback ? 'local-product' : Uri(scheme: base.scheme, host: base.host,
    port: base.hasPort ? base.port : null, path: base.path).toString();
  return '$server.$companyId.$branchId.$userId.$kind.$orderId';
}

/// One unresolved request per company, branch, user and order. Never replace
/// an uncertain request with a new key: retry exactly the original payload.
class OrderRetryStore {
  OrderRetryStore(this._preferences);
  final SharedPreferences _preferences;
  static final Set<String> _writing = <String>{};

  String _key(String scope) => 'order.pending.$scope';

  Map<String, dynamic>? read(String scope) {
    final stored = _preferences.getString(_key(scope));
    if (stored == null) return null;
    final value = jsonDecode(stored);
    if (value is! Map) throw const FormatException('Invalid pending order request');
    return Map<String, dynamic>.from(value);
  }

  Future<Map<String, dynamic>> begin(
    String scope, {
    required String method,
    required String path,
    required Map<String, dynamic> body,
  }) async {
    if (!_writing.add(scope)) throw StateError('An order request is already being saved');
    try {
      if (read(scope) != null) {
        throw StateError('An earlier order request must be resolved first');
      }
      final request = <String, dynamic>{
        'method': method,
        'path': path,
        'body': {...body, 'idempotencyKey': const Uuid().v4()},
      };
      if (!await _preferences.setString(_key(scope), jsonEncode(request))) {
        throw StateError('Could not preserve the retry request');
      }
      return request;
    } finally {
      _writing.remove(scope);
    }
  }

  Future<void> complete(String scope) async {
    if (!await _preferences.remove(_key(scope))) {
      throw StateError('Could not clear the completed request');
    }
  }
}
