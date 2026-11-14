import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../../core/platform/picked_file.dart';

/// The picture stored for an item.
///
/// The server owns validation and re-encodes everything it accepts, so this
/// client sends the user's file and shows the server's answer. It deliberately
/// does not try to be clever about formats: a second opinion on this machine
/// would only produce a different message for the same refusal.
class ItemImage {
  const ItemImage({
    required this.itemId,
    this.data,
    this.mime,
    this.width,
    this.height,
  });

  final String itemId;
  final List<int>? data;
  final String? mime;
  final int? width;
  final int? height;

  bool get hasPicture => mime != null && (data?.isNotEmpty ?? false);

  factory ItemImage.empty(String itemId) => ItemImage(itemId: itemId);

  factory ItemImage.fromJson(String itemId, Map<String, dynamic> json) {
    final encoded = json['data'];
    return ItemImage(
      itemId: itemId,
      data: encoded is String && encoded.isNotEmpty
          ? _decodeBase64(encoded)
          : null,
      mime: json['mime'] as String?,
      width: (json['width'] as num?)?.toInt(),
      height: (json['height'] as num?)?.toInt(),
    );
  }

  /// The API answers base64 in a JSON body, so the bytes are decoded here
  /// rather than being left to each caller.
  static List<int>? _decodeBase64(String value) {
    try {
      return base64Decode(value);
    } on FormatException {
      return null;
    }
  }
}

/// Item pictures: read, replace, remove, and ask which items have one.
class ItemImageDataSource {
  ItemImageDataSource(this._client);

  final ApiClient _client;

  String _path(String itemId) => '/inventory/items/$itemId/image';

  Future<ItemImage> fetch(String itemId) async {
    final json = await _client.get(_path(itemId));
    return ItemImage.fromJson(itemId, json);
  }

  /// Replaces the picture with [file]. The server validates, re-encodes and
  /// answers with the stored dimensions.
  Future<ItemImage> upload(String itemId, PickedFile file) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
    });
    await _client.post(_path(itemId), body: form);
    // Read back rather than trusting the upload's echo: what is on the server
    // after the write is the only thing the user should see.
    return fetch(itemId);
  }

  Future<void> remove(String itemId) => _client.delete(_path(itemId));

  /// Which of these items have a picture, in one request.
  ///
  /// The endpoint hangs off a single item id only because the route does; the
  /// ids it answers about are the ones passed in `itemIds`.
  Future<Set<String>> presence(List<String> itemIds) async {
    if (itemIds.isEmpty) return const {};
    final json = await _client.get(
      '${_path(itemIds.first)}/presence?itemIds=${itemIds.join(',')}',
    );
    final ids = json['itemIds'];
    if (ids is! List) return const {};
    return ids.whereType<String>().toSet();
  }

  /// Small pictures for a page of items, in one request.
  ///
  /// A catalogue page draws 32-pixel squares; asking for each full picture
  /// would be one request per row and a page's worth of full-size images in
  /// memory. The server reduces each to a thumbnail and returns only the rows
  /// that have one, so an absent key means "show the placeholder".
  Future<Map<String, Uint8List>> thumbnails(List<String> itemIds) async {
    if (itemIds.isEmpty) return const {};
    final json = await _client.get(
      '/inventory/items/with-picture?itemIds=${itemIds.join(',')}',
    );
    final rows = json['pictures'];
    if (rows is! List) return const {};
    final result = <String, Uint8List>{};
    for (final row in rows) {
      if (row is! Map) continue;
      final id = row['itemId'];
      final data = row['data'];
      if (id is! String || data is! String) continue;
      final bytes = _decodeBase64Bytes(data);
      if (bytes != null) result[id] = bytes;
    }
    return result;
  }

  static Uint8List? _decodeBase64Bytes(String value) {
    try {
      return base64Decode(value);
    } on FormatException {
      return null;
    }
  }
}
