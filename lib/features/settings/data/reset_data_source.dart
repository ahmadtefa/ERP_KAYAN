import '../../../core/network/api_client.dart';

/// What a reset would take away, counted so the warning can name numbers.
class ResetPreview {
  const ResetPreview({
    required this.companyCode,
    required this.companyName,
    required this.counts,
    required this.confirmationWord,
  });

  final String companyCode;
  final String companyName;
  final Map<String, int> counts;
  final String confirmationWord;

  /// The company as a person names it: the name when there is one, otherwise
  /// the code, which always exists.
  String get companyLabel =>
      companyName.trim().isEmpty ? companyCode : companyName.trim();

  /// Everything that would go, added up. "Nothing" is a perfectly good
  /// answer to give, and the screen says so rather than showing an empty
  /// list of numbers.
  int get totalRecords =>
      counts.values.fold<int>(0, (sum, value) => sum + value);
}

/// What came back from a reset that ran.
class ResetResult {
  const ResetResult({
    required this.backupFile,
    required this.backupBytes,
    required this.backupEntries,
    required this.deleted,
    required this.needsSetup,
  });

  /// The name of the file on the server that holds the old data.
  final String backupFile;
  final int backupBytes;
  final int backupEntries;
  final Map<String, int> deleted;
  final bool needsSetup;
}

/// «إعادة ضبط بيانات البرنامج» — Reset ERP Data.
///
/// The most destructive thing the program offers, so the client's job here
/// is mostly to be sure: it shows what will go before anything is typed, it
/// sends the administrator's password for the server to check against its
/// own hash, and it sends the typed confirmation word rather than deciding
/// for itself that a click was enough.
class ResetDataSource {
  ResetDataSource(this._client);

  final ApiClient _client;

  static const _path = '/admin/reset';

  /// What would be removed. Counting changes nothing.
  Future<ResetPreview> preview() async {
    final data = await _client.get(_path);
    return ResetPreview(
      companyCode: '${data['companyCode'] ?? ''}',
      companyName: '${data['companyName'] ?? ''}',
      counts: _counts(data['counts']),
      confirmationWord: '${data['confirmationWord'] ?? 'RESET'}',
    );
  }

  /// Clears the company's data.
  ///
  /// The server takes and checks a backup first and refuses outright if
  /// either fails, so a successful answer always means the old data is
  /// sitting in a file that can be read back.
  Future<ResetResult> reset({
    required String password,
    required String confirmation,
  }) async {
    final data = await _client.post(
      _path,
      body: <String, dynamic>{'password': password, 'confirmation': confirmation},
    );
    return ResetResult(
      backupFile: '${data['backupFile'] ?? ''}',
      backupBytes: int.tryParse('${data['backupBytes'] ?? 0}') ?? 0,
      backupEntries: int.tryParse('${data['backupEntries'] ?? 0}') ?? 0,
      deleted: _counts(data['deleted']),
      needsSetup: data['needsSetup'] == true,
    );
  }

  static Map<String, int> _counts(Object? raw) {
    if (raw is! Map) return const {};
    return raw.map<String, int>(
      (key, value) => MapEntry('$key', int.tryParse('$value') ?? 0),
    );
  }
}
