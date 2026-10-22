import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/download_request.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

export '../../../auth/presentation/providers/auth_providers.dart'
    show appConfigProvider;

/// Builds the address of a report file or a print page, and the credential
/// that has to travel in it.
///
/// The browser opens these links itself: a new tab cannot carry an
/// Authorization header. What goes in the address is therefore a one-minute
/// download ticket minted for the occasion, never the sign-in token - see
/// `_downloadTicket`.
final reportLinkProvider = Provider<ReportLinkBuilder>(
  (ref) => ReportLinkBuilder(ref),
);

class ReportLinkBuilder {
  ReportLinkBuilder(this._ref);

  final Ref _ref;

  /// A ticket already minted, and when it stops being good.
  ///
  /// Several buttons are often pressed in a row, and a ticket is good for a
  /// minute anyway, so the same one is reused until it is nearly spent
  /// rather than asking the server for a new one on every click.
  String? _ticket;
  DateTime? _ticketExpiresAt;

  String get _base => _ref.read(appConfigProvider).apiBaseUrl;

  /// Asks the server for a one-minute credential to put in an address.
  ///
  /// A print page opened in a new tab is a navigation, and a navigation
  /// cannot carry an Authorization header — so something has to travel in
  /// the address. It is a ticket rather than the sign-in token, because an
  /// address ends up in browser history and in logs, and because a ticket
  /// buys this one file and nothing else.
  Future<String> _downloadTicket() async {
    final now = DateTime.now();
    final held = _ticket;
    final expiresAt = _ticketExpiresAt;
    if (held != null &&
        expiresAt != null &&
        now.isBefore(expiresAt.subtract(const Duration(seconds: 10)))) {
      return held;
    }
    final response = await _ref
        .read(apiClientProvider)
        .raw
        .post<Map<String, dynamic>>('/auth/download-ticket');
    final data = Map<String, dynamic>.from(response.data ?? const {});
    final ticket = '${data['ticket'] ?? ''}';
    if (ticket.isEmpty) {
      throw StateError(
        'The server did not issue a download ticket. Sign in again and '
        'try once more.',
      );
    }
    final seconds = int.tryParse('${data['expiresIn'] ?? 60}') ?? 60;
    _ticket = ticket;
    _ticketExpiresAt = now.add(Duration(seconds: seconds));
    return ticket;
  }

  /// A spreadsheet or a CSV of one report.
  Future<DownloadRequest> file({
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
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/exports/$report/download?${_encode(query)}',
    );
  }

  /// The report as a PDF file, made by the server.
  Future<DownloadRequest> pdf({
    required String report,
    required String language,
    String? from,
    String? to,
    String? accountId,
  }) async {
    final query = <String, String>{
      'lang': language,
      'from': ?from,
      'to': ?to,
      'accountId': ?accountId,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(url: '$_base/exports/$report/pdf?${_encode(query)}');
  }

  /// The print page, opened in a new tab. `auto` opens the print dialogue by
  /// itself — a tab has no way to send a header, so this one carries a
  /// ticket in the address.
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
      'ticket': await _downloadTicket(),
    };
    return '$_base/exports/$report/print?${_encode(query)}';
  }

  /// ── the everyday lists ──
  ///
  /// Same idea as a report, one word different in the path: a list is named
  /// after the screen it came from, and carries whatever filter that screen
  /// is currently showing, so the file matches what the person can see.

  /// A list as a spreadsheet or a plain file.
  Future<DownloadRequest> listFile({
    required String list,
    required String format,
    required String language,
    Map<String, String> filters = const {},
  }) async {
    final query = <String, String>{
      'format': format,
      'lang': language,
      ...filters,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/exports/lists/$list/download?${_encode(query)}',
    );
  }

  /// A list as a PDF file, made by the server.
  Future<DownloadRequest> listPdf({
    required String list,
    required String language,
    Map<String, String> filters = const {},
  }) async {
    final query = <String, String>{
      'lang': language,
      ...filters,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/exports/lists/$list/pdf?${_encode(query)}',
    );
  }

  /// A list as a page to print.
  Future<String> listPrint({
    required String list,
    required String language,
    bool auto = true,
    Map<String, String> filters = const {},
  }) async {
    final query = <String, String>{
      'lang': language,
      if (auto) 'auto': '1',
      ...filters,
      'ticket': await _downloadTicket(),
    };
    return '$_base/exports/lists/$list/print?${_encode(query)}';
  }

  Future<DownloadRequest> documentFile({
    required String kind,
    required String id,
    required String format,
    required String language,
  }) async {
    final query = <String, String>{
      'format': format,
      'lang': language,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/exports/documents/$kind/$id/download?${_encode(query)}',
    );
  }

  Future<DownloadRequest> documentPdf({
    required String kind,
    required String id,
    required String language,
  }) async {
    final query = <String, String>{
      'lang': language,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/exports/documents/$kind/$id/pdf?${_encode(query)}',
    );
  }

  Future<String> documentPrint({
    required String kind,
    required String id,
    required String language,
    bool auto = true,
  }) async {
    final query = <String, String>{
      'lang': language,
      if (auto) 'auto': '1',
      'ticket': await _downloadTicket(),
    };
    return '$_base/exports/documents/$kind/$id/print?${_encode(query)}';
  }

  /// Opens the branded quotation print preview in a new tab. It carries a
  /// one-minute ticket, like every other browser-facing file.
  Future<String> quotationPrint({
    required String id,
    required String language,
    bool auto = true,
  }) async {
    final query = <String, String>{
      'lang': language,
      if (auto) 'auto': '1',
      'ticket': await _downloadTicket(),
    };
    return '$_base/sales/quotations/$id/print?${_encode(query)}';
  }

  /// The quotation as the finished PDF the customer receives.
  Future<DownloadRequest> quotationPdf({
    required String id,
    required String language,
  }) async {
    final query = <String, String>{
      'lang': language,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/sales/quotations/$id/pdf?${_encode(query)}',
    );
  }

  /// A blank spreadsheet to fill in, for one kind of import.
  Future<DownloadRequest> importTemplate({
    required String kind,
    required String language,
  }) async {
    final query = <String, String>{
      'lang': language,
      'ticket': await _downloadTicket(),
    };
    return DownloadRequest(
      url: '$_base/import/templates/$kind?${_encode(query)}',
      fileName: 'kayan-template-$kind.xlsx',
    );
  }

  /// The whole company, as one file.
  Future<DownloadRequest> backup() async {
    final query = <String, String>{'ticket': await _downloadTicket()};
    return DownloadRequest(url: '$_base/backup/download?${_encode(query)}');
  }

  /// The bundled sample company backup, not a restore shortcut.
  Future<DownloadRequest> demoBackup() async {
    final query = <String, String>{'ticket': await _downloadTicket()};
    return DownloadRequest(
      url: '$_base/backup/demo/download?${_encode(query)}',
      fileName: 'kayan-company-backup-demo.json',
    );
  }

  /// One full-database backup file, sitting on the server.
  Future<DownloadRequest> fullBackupDownload(String name) async {
    final query = <String, String>{'ticket': await _downloadTicket()};
    return DownloadRequest(
      url: '$_base/backup/full/${Uri.encodeComponent(name)}/download'
          '?${_encode(query)}',
    );
  }

  String _encode(Map<String, String> query) => query.entries
      .map((entry) => '${entry.key}=${Uri.encodeQueryComponent(entry.value)}')
      .join('&');
}

/// The spreadsheet templates supported by the import service.
enum ImportKind {
  customers,
  suppliers,
  items,
  chartOfAccounts,
  openingBalances;

  /// The name the API uses.
  String get slug => switch (this) {
    ImportKind.customers => 'customers',
    ImportKind.suppliers => 'suppliers',
    ImportKind.items => 'items',
    ImportKind.chartOfAccounts => 'chart-of-accounts',
    ImportKind.openingBalances => 'opening-balances',
  };

  bool get supportsUpsert => this == ImportKind.customers ||
      this == ImportKind.suppliers ||
      this == ImportKind.items;
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

  List<Map<String, dynamic>> get errors => (raw['errors'] as List? ?? const [])
      .whereType<Map>()
      .map(Map<String, dynamic>.from)
      .toList();

  List<Map<String, dynamic>> get preview =>
      (raw['preview'] as List? ?? const [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();

  List<String> get unknownColumns =>
      (raw['unknownColumns'] as List? ?? const [])
          .map((value) => '$value')
          .toList();

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

  void chooseMode(ImportMode mode) {
    // The dry run counted what would happen in the old mode; those numbers
    // cannot vouch for the button that writes in the new one.
    state = state.copyWith(mode: mode, clearReport: true);
  }

  void chooseFile(PickedFile? file) => state = state.copyWith(
    file: file,
    clearFile: file == null,
    clearReport: true,
  );

  void beginning() =>
      state = state.copyWith(busy: true, failure: null, clearReport: true);

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
      report != null &&
      report!.dryRun &&
      !report!.hasErrors &&
      (report!.created + report!.updated) > 0;

  ImportState copyWith({
    ImportKind? kind,
    ImportMode? mode,
    PickedFile? file,
    bool clearFile = false,
    bool? busy,
    ImportReport? report,
    bool clearReport = false,
    String? failure,
  }) {
    return ImportState(
      kind: kind ?? this.kind,
      mode: mode ?? this.mode,
      file: clearFile ? null : (file ?? this.file),
      busy: busy ?? this.busy,
      // A report can be replaced, and it can be thrown away - but it must
      // never survive a change that makes its numbers meaningless.
      report: clearReport ? null : (report ?? this.report),
      failure: failure,
    );
  }
}

final importControllerProvider =
    NotifierProvider<ImportController, ImportState>(ImportController.new);

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

/// Full-database backups: the whole PostgreSQL archive, for disasters.
class FullBackupService {
  FullBackupService(this._dio);

  final Dio _dio;

  static const _path = '/backup/full';

  /// What this machine can do, and whether a restore is running right now.
  Future<Map<String, dynamic>> capabilities() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_path/capabilities',
    );
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  Future<List<Map<String, dynamic>>> list() async {
    final response = await _dio.get<List<dynamic>>(_path);
    return (response.data ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList(growable: false);
  }

  Future<Map<String, dynamic>> create() async {
    // A full pg_dump plus its read-back validation legitimately takes
    // longer than the client's ordinary 30-second receive timeout; with
    // the default, the request was aborted on the client while the server
    // was still working, which looked like a backup that hangs forever.
    final response = await _dio.post<Map<String, dynamic>>(
      _path,
      options: Options(receiveTimeout: const Duration(minutes: 15)),
    );
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  Future<void> delete(String name) =>
      _dio.delete<dynamic>('$_path/${Uri.encodeComponent(name)}');

  /// Restores the whole database from a file on the server or an upload.
  ///
  /// [confirm] must be true — the screen makes the person type the
  /// confirmation before it sends this.
  Future<Map<String, dynamic>> restore({
    PickedFile? file,
    String? fileName,
    required bool confirm,
  }) async {
    final form = FormData.fromMap({
      if (file != null)
        'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
      'fileName': ?fileName,
      'confirm': confirm,
    });
    final response = await _dio.post<Map<String, dynamic>>(
      '$_path/restore',
      data: form,
      queryParameters: {'confirm': confirm},
      // Uploading an archive and restoring it (rehearsal + safety copy +
      // restore + checks) is the longest operation in the program.
      options: Options(
        contentType: 'multipart/form-data',
        sendTimeout: const Duration(minutes: 30),
        receiveTimeout: const Duration(minutes: 30),
      ),
    );
    return Map<String, dynamic>.from(response.data ?? const {});
  }
}

final fullBackupServiceProvider = Provider<FullBackupService>(
  (ref) => FullBackupService(ref.read(apiClientProvider).raw),
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

/// What this installation can produce.
///
/// A PDF needs a browser on the server to lay out Arabic. Where there is none,
/// the PDF button is not shown at all rather than shown and then failing - and
/// the print button, which always works, says how to get the same file.
class ExportCapabilities {
  const ExportCapabilities({
    required this.formats,
    required this.pdfOnTheServer,
  });

  final List<String> formats;
  final bool pdfOnTheServer;

  static const ExportCapabilities unknown = ExportCapabilities(
    formats: ['xlsx', 'csv'],
    pdfOnTheServer: false,
  );

  factory ExportCapabilities.from(Map<String, dynamic> data) {
    return ExportCapabilities(
      formats: (data['formats'] as List? ?? const ['xlsx', 'csv'])
          .map((value) => '$value')
          .toList(),
      pdfOnTheServer: data['pdfOnTheServer'] == true,
    );
  }
}

/// Asked once when the app starts; the answer does not change while it runs.
final exportCapabilitiesProvider = FutureProvider<ExportCapabilities>((
  ref,
) async {
  try {
    final response = await ref
        .read(apiClientProvider)
        .raw
        .get<Map<String, dynamic>>('/exports/capabilities');
    return ExportCapabilities.from(
      Map<String, dynamic>.from(response.data ?? const {}),
    );
  } catch (_) {
    // A server that cannot answer is a server that cannot make a PDF.
    return ExportCapabilities.unknown;
  }
});

/// What the company holds right now, for the backup screen's summary.
final backupSummaryProvider = FutureProvider<Map<String, dynamic>>(
  (ref) => ref.read(dataServiceProvider).backupSummary(),
);
