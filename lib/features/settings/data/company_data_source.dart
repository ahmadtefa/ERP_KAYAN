import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../../core/platform/picked_file.dart';

/// Company profile, logo and units (headquarters and branches).
///
/// The server owns the rules: one headquarters per company, a branch hangs
/// from a parent unit, no circles. The client sends intent and shows answers.
class CompanyDataSource {
  CompanyDataSource(this._client);

  final ApiClient _client;

  static const _path = '/company';

  Future<Map<String, dynamic>> fetchProfile() => _client.get('$_path/profile');

  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> patch) =>
      _client.patch('$_path/profile', body: patch);

  Future<List<Map<String, dynamic>>> fetchBranches() =>
      _client.getList('$_path/branches');

  Future<Map<String, dynamic>> createBranch(Map<String, dynamic> body) =>
      _client.post('$_path/branches', body: body);

  Future<Map<String, dynamic>> updateBranch(
    String id,
    Map<String, dynamic> body,
  ) => _client.patch('$_path/branches/$id', body: body);

  Future<void> deleteBranch(String id) => _client.delete('$_path/branches/$id');

  Future<Map<String, dynamic>> uploadLogo(PickedFile file) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
    });
    final response = await _client.raw.post<dynamic>(
      '$_path/logo',
      data: form,
    );
    final data = response.data;
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  Future<void> removeLogo() => _client.delete('$_path/logo');
}
