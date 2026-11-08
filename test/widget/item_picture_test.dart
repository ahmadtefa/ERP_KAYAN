import 'dart:convert';
import 'dart:typed_data';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/data/item_image_data_source.dart';
import 'package:erp_kayan/features/inventory/presentation/widgets/item_picture.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// A tiny valid PNG header is enough: `Image.memory` is given an errorBuilder,
/// so the widget under test is the state handling, not the decoder.
final _png = Uint8List.fromList(<int>[
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

class _ImageApi extends ApiClient {
  _ImageApi({this.hasPicture = false, this.failFetch = false, this.failDelete = false})
    : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());

  bool hasPicture;
  bool failFetch;
  bool failDelete;
  int fetches = 0;
  int deletes = 0;
  int batchRequests = 0;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.endsWith('/items/with-picture')) {
      batchRequests++;
      // Only the first id has a picture; the second must come back absent,
      // which is how the catalogue knows to draw a placeholder.
      return {
        'pictures': [
          {'itemId': 'item-1', 'data': base64Encode(_png)},
        ],
      };
    }
    if (path.contains('/image')) {
      fetches++;
      if (failFetch) throw StateError('NETWORK_DOWN');
      if (!hasPicture) {
        return {'mime': null, 'data': null, 'width': null, 'height': null};
      }
      return {
        'mime': 'image/webp',
        'data': base64Encode(_png),
        'width': 640,
        'height': 480,
      };
    }
    throw StateError('UNEXPECTED_GET $path');
  }

  @override
  Future<Map<String, dynamic>> delete(String path) async {
    deletes++;
    if (failDelete) throw StateError('NETWORK_DOWN');
    hasPicture = false;
    return {'deleted': true};
  }
}

Widget _host(_ImageApi api) => ProviderScope(
  overrides: [apiClientProvider.overrideWithValue(api)],
  child: MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: const Scaffold(body: ItemPictureEditor(itemId: 'item-1')),
  ),
);

void main() {
  testWidgets('reads the picture from the server and offers to change it', (tester) async {
    final api = _ImageApi(hasPicture: true);
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();

    expect(api.fetches, 1, reason: 'the editor must ask the server, not guess');
    // Replace is offered once a picture exists; the remove action appears too.
    expect(find.byKey(const Key('item-image-choose')), findsOneWidget);
    expect(find.byKey(const Key('item-image-remove')), findsOneWidget);
  });

  testWidgets('offers an add action when the item has no picture', (tester) async {
    final api = _ImageApi();
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('item-image-choose')), findsOneWidget);
    // Nothing to remove, so no remove button.
    expect(find.byKey(const Key('item-image-remove')), findsNothing);
  });

  testWidgets('removing the picture calls the server and drops the preview', (tester) async {
    final api = _ImageApi(hasPicture: true);
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('item-image-remove')));
    await tester.pumpAndSettle();

    expect(api.deletes, 1);
    expect(find.byKey(const Key('item-image-remove')), findsNothing);
  });

  testWidgets('a failed delete is reported and the truth is re-read', (tester) async {
    final api = _ImageApi(hasPicture: true, failDelete: true);
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    final fetchesBefore = api.fetches;

    await tester.tap(find.byKey(const Key('item-image-remove')));
    await tester.pumpAndSettle();

    expect(api.deletes, 1);
    // The deletion may have committed before the response was lost, so the
    // editor re-reads instead of trusting its own guess.
    expect(api.fetches, greaterThan(fetchesBefore));
  });

  testWidgets('a failed read says so rather than showing an empty picture', (tester) async {
    final api = _ImageApi(failFetch: true);
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();

    expect(find.textContaining('could not be loaded'), findsOneWidget);
  });

  testWidgets('the thumbnail falls back to a placeholder when there is no picture', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ItemThumbnail(bytes: null))),
    );

    expect(find.byIcon(Icons.inventory_2_outlined), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('the thumbnail renders stored bytes', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: ItemThumbnail(bytes: _png))),
    );

    expect(find.byType(Image), findsOneWidget);
  });

  test('a page of thumbnails is one request, and only rows with a picture come back', () async {
    final api = _ImageApi();
    final source = ItemImageDataSource(api);

    final pictures = await source.thumbnails(const ['item-1', 'item-2']);

    expect(api.batchRequests, 1);
    expect(pictures.keys, ['item-1']);
    expect(pictures['item-1'], isNotNull);
    // The missing row is absent rather than an empty entry, so the caller can
    // tell "no picture" from "picture failed to decode".
    expect(pictures.containsKey('item-2'), isFalse);
  });

  test('an empty page asks the server nothing at all', () async {
    final api = _ImageApi();
    final source = ItemImageDataSource(api);

    expect(await source.thumbnails(const []), isEmpty);
    expect(api.batchRequests, 0);
  });
}
