import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// Where the server is, so a download link can be built.
final appConfigProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

/// Builds the URL of a report file or a print page.
///
/// The token travels in the address because the browser opens these links
/// itself - a new tab cannot carry an Authorization header. The server accepts
/// a query token on these two routes only.
final reportLinkProvider =
    Provider<ReportLinkBuilder>((ref) => ReportLinkBuilder(ref));

class ReportLinkBuilder {
  ReportLinkBuilder(this._ref);

  final Ref _ref;

  String get _base => _ref.read(appConfigProvider).apiBaseUrl;

  Future<String> _token() async {
    final token = await _ref.read(tokenStoreProvider).readAccessToken();
    return token ?? '';
  }

  /// A spreadsheet or a CSV of one report.
  Future<String> file({
    required String report,
    required String format,
    required String language,
    String? from,
    String? to,
    String? accountId,
    String? branchId,
  }) async {
    final query = <String, String>{
      'format': format,
      'lang': language,
      'from': ?from,
      'to': ?to,
      'accountId': ?accountId,
      'branchId': ?branchId,
      'token': await _token(),
    };
    return '$_base/exports/$report/download?${_encode(query)}';
  }

  /// The print page. `auto` opens the print dialogue by itself.
  Future<String> print({
    required String report,
    required String language,
    bool auto = true,
    String? from,
    String? to,
    String? accountId,
  }) async {
    final query = <String, String>{
      'lang': language,
      if (auto) 'auto': '1',
      'from': ?from,
      'to': ?to,
      'accountId': ?accountId,
      'token': await _token(),
    };
    return '$_base/exports/$report/print?${_encode(query)}';
  }

  /// A blank spreadsheet to fill in, for one kind of import.
  Future<String> importTemplate({required String kind, required String language}) async {
    final query = <String, String>{'lang': language, 'token': await _token()};
    return '$_base/import/templates/$kind?${_encode(query)}';
  }

  /// The whole company, as one file.
  Future<String> backup() async {
    return '$_base/backup/download?token=${await _token()}';
  }

  String _encode(Map<String, String> query) => query.entries
      .map((entry) => '${entry.key}=${Uri.encodeQueryComponent(entry.value)}')
      .join('&');
}

/// The three kinds of master data a file can carry.
enum ImportKind {
  customers,
  suppliers,
  items;

  /// The name the API uses.
  String get slug => switch (this) {
        ImportKind.customers => 'customers',
        ImportKind.suppliers => 'suppliers',
        ImportKind.items => 'items',
      };
}

/// What happens to a record the file carries that already exists.
enum ImportMode {
  /// Leave it alone and count it as skipped. The safe default.
  insert,

  /// Update the columns the file carries, and only those.
  upsert;

  String get slug => this == ImportMode.upsert ? 'upsert' : 'insert';
}

/// The outcome of reading a file, whether it was a dry run or the real thing.
class ImportReport {
  const ImportReport(this.raw);

  final Map<String, dynamic> raw;

  bool get dryRun => raw['dryRun'] == true;
  int get totalRows => _int('totalRows');
  int get created => _int('created');
  int get updated => _int('updated');
  int get skipped => _int('skipped');

  List<Map<String, dynamic>> get errors =>
      (raw['errors'] as List? ?? const []).whereType<Map>().map(Map<String, dynamic>.from).toList();

  List<Map<String, dynamic>> get preview =>
      (raw['preview'] as List? ?? const []).whereType<Map>().map(Map<String, dynamic>.from).toList();

  List<String> get unknownColumns =>
      (raw['unknownColumns'] as List? ?? const []).map((value) => '$value').toList();

  bool get hasErrors => errors.isNotEmpty;

  int _int(String key) => int.tryParse('${raw[key] ?? 0}') ?? 0;
}

/// The import screen's state: which kind, what was read, and what came back.
class ImportController extends Notifier<ImportState> {
  @override
  ImportState build() => const ImportState();

  void chooseKind(ImportKind kind) {
    // A new kind invalidates the previous result: the counts on screen
    // belonged to a different list.
    state = ImportState(kind: kind);
  }

  void chooseMode(ImportMode mode) => state = state.copyWith(mode: mode);

  void chooseFile(PickedFile? file) =>
      state = state.copyWith(file: file, report: null, failure: null, clearFile: file == null);

  void beginning() =>
      state = state.copyWith(busy: true, failure: null, report: null);

  void succeeded(ImportReport report) =>
      state = state.copyWith(busy: false, report: report, failure: null);

  void failed(String message) =>
      state = state.copyWith(busy: false, failure: message);

  void reset() => state = const ImportState();
}

class ImportState {
  const ImportState({
    this.kind = ImportKind.customers,
    this.mode = ImportMode.insert,
    this.file,
    this.busy = false,
    this.report,
    this.failure,
  });

  final ImportKind kind;
  final ImportMode mode;
  final PickedFile? file;
  final bool busy;
  final ImportReport? report;
  final String? failure;

  bool get canUpload => file != null && !busy;

  /// Whether the last run was a dry run that found something to write. Only
  /// then does the "import for real" button make sense.
  bool get readyToCommit =>
      report != null && report!.dryRun && !report!.hasErrors && (report!.created + report!.updated) > 0;

  ImportState copyWith({
    ImportKind? kind,
    ImportMode? mode,
    PickedFile? file,
    bool clearFile = false,
    bool? busy,
    ImportReport? report,
    String? failure,
  }) {
    return ImportState(
      kind: kind ?? this.kind,
      mode: mode ?? this.mode,
      file: clearFile ? null : (file ?? this.file),
      busy: busy ?? this.busy,
      report: report ?? this.report,
      failure: failure,
    );
  }
}

final importControllerProvider = NotifierProvider<ImportController, ImportState>(
  ImportController.new,
);

/// Talks to the import and backup routes.
class DataService {
  DataService(this._dio);

  final Dio _dio;

  /// Sends a file to be imported.
  ///
  /// [dryRun] reads the file and reports what would happen without writing
  /// anything, which is what the screen shows first.
  Future<ImportReport> import({
    required ImportKind kind,
    required PickedFile file,
    required ImportMode mode,
    required bool dryRun,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
    });
    final response = await _dio.post<Map<String, dynamic>>(
      '/import/${kind.slug}',
      data: form,
      queryParameters: {'dryRun': dryRun, 'mode': mode.slug},
      options: Options(contentType: 'multipart/form-data'),
    );
    return ImportReport(Map<String, dynamic>.from(response.data ?? const {}));
  }

  Future<Map<String, dynamic>> backupSummary() async {
    final response = await _dio.get<Map<String, dynamic>>('/backup/summary');
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  /// Reads a backup file without touching anything.
  Future<Map<String, dynamic>> inspectBackup(PickedFile file) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/backup/inspect',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
      }),
      options: Options(contentType: 'multipart/form-data'),
    );
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  /// Puts a backup back. [replace] is required when the company holds data.
  Future<Map<String, dynamic>> restoreBackup(
    PickedFile file, {
    required bool replace,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/backup/restore',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
      }),
      queryParameters: {'replace': replace},
      options: Options(contentType: 'multipart/form-data'),
    );
    return Map<String, dynamic>.from(response.data ?? const {});
  }
}

final dataServiceProvider = Provider<DataService>(
  (ref) => DataService(ref.read(apiClientProvider).raw),
);

/// Turns whatever was thrown into something worth reading.
///
/// The API answers errors as Problem Details - a title and a `detail` written
/// to be read by a person, e.g. why a file was refused. That message is shown
/// as it is; anything else falls back to the exception's own text rather than
/// pretending nothing went wrong.
String describeApiError(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      final detail = data['detail'] ?? data['title'];
      if (detail is String && detail.trim().isNotEmpty) return detail;
    }
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return 'The server took too long to answer. Try again.';
      case DioExceptionType.connectionError:
        return 'The server could not be reached. Check that it is running.';
      default:
        break;
    }
  }
  return error.toString();
}

/// What the company holds right now, for the backup screen's summary.
final backupSummaryProvider = FutureProvider<Map<String, dynamic>>(
  (ref) => ref.read(dataServiceProvider).backupSummary(),
);
