import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// One unresolved request per company, branch, user and order. Never replace
/// an uncertain request with a new key: retry exactly the original payload.
class OrderRetryStore {
  OrderRetryStore(this._preferences);
  final SharedPreferences _preferences;

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
  }

  Future<void> complete(String scope) async {
    if (!await _preferences.remove(_key(scope))) {
      throw StateError('Could not clear the completed request');
    }
  }
}
