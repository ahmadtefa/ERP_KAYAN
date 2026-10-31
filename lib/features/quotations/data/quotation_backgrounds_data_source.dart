import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/platform/picked_file.dart';

/// One PDF the company attached as its letterhead.
///
/// The numbers here were measured from the file's own bytes by the server -
/// page count and page size are never taken from what the upload claimed - so
/// the screen can say "3 pages, A4" without guessing and the offer can be laid
/// out on the artwork's real page box.
class QuotationBackgroundFile {
  const QuotationBackgroundFile({
    required this.id,
    required this.name,
    required this.byteSize,
    required this.pageCount,
    required this.pageWidth,
    required this.pageHeight,
    this.createdAt,
  });

  factory QuotationBackgroundFile.fromJson(Map<String, dynamic> json) {
    double number(dynamic value) {
      if (value is num) return value.toDouble();
      return double.tryParse('${value ?? ''}') ?? 0;
    }

    return QuotationBackgroundFile(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? 'PDF'}',
      byteSize: number(json['byteSize']).round(),
      pageCount: number(json['pageCount']).round(),
      pageWidth: number(json['pageWidth']),
      pageHeight: number(json['pageHeight']),
    );
  }

  final String id;
  final String name;
  final int byteSize;
  final int pageCount;

  /// In PDF points (1/72"), as the file states them.
  final double pageWidth;
  final double pageHeight;

  /// When it was attached, for the library list. Optional: the API may omit it.
  final String? createdAt;

  String get readableSize {
    if (byteSize < 1024) return '$byteSize B';
    if (byteSize < 1024 * 1024) return '${(byteSize / 1024).toStringAsFixed(0)} KB';
    return '${(byteSize / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  /// Width × height in millimetres, which is what a person recognises.
  String get readableSheet {
    final width = (pageWidth * 25.4 / 72).round();
    final height = (pageHeight * 25.4 / 72).round();
    return '$width × $height mm';
  }

  bool get isMultiPage => pageCount > 1;
}

/// The artwork library: the PDFs a company may print its offers on.
///
/// Uploading is the same permission as editing a quotation - an operator who may
/// design an offer may attach the company's letterhead - and reading a file is
/// the same permission as reading an offer, so a preview can be shown without
/// granting anything extra.
class QuotationBackgroundsDataSource {
  QuotationBackgroundsDataSource(this._client);

  final ApiClient _client;

  static const _path = '/sales/quotation-backgrounds';

  Future<List<QuotationBackgroundFile>> fetch() async {
    final rows = await _client.getList(_path);
    return rows
        .map(QuotationBackgroundFile.fromJson)
        .where((file) => file.id.isNotEmpty)
        .toList(growable: false);
  }

  /// Sends the chosen PDF. The file's bytes are the only thing the server
  /// trusts: it checks the signature, the trailer, that a parser can open it,
  /// how many pages it has and how big they are.
  Future<QuotationBackgroundFile> upload(PickedFile file) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
      'name': file.name,
    });
    final response = await _client.post(_path, body: form);
    return QuotationBackgroundFile.fromJson(response);
  }

  Future<void> rename(String id, String name) =>
      _client.put('$_path/$id', body: {'name': name});

  Future<void> remove(String id) => _client.delete('$_path/$id');
}
