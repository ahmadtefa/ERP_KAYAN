import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/auth/presentation/widgets/user_photo.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _PhotoClient extends ApiClient {
  _PhotoClient(this.bytes) : super(const AppConfig(environment:AppEnvironment.development,
    apiBaseUrl:'https://test.invalid/api/v1',connectTimeout:Duration(seconds:1),receiveTimeout:Duration(seconds:1)),FakeTokenStore());
  final Uint8List bytes;
  final Map<String,Uint8List> photos = {};
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async {
    final photo = photos[query?['expectedUserId']];
    return {'mime':photo == null ? null : 'image/webp','data':photo == null ? null : base64Encode(photo)};
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    final form = body! as FormData;
    expect(path,'/profile/photo'); expect(form.files.single.key,'file');
    final id = form.fields.singleWhere((field) => field.key == 'expectedUserId').value;
    photos[id] = bytes;
    return {'updated':true};
  }
  @override
  Future<Map<String,dynamic>> delete(String path) async {
    photos.remove(Uri.parse(path).queryParameters['expectedUserId']);
    return {'deleted':true};
  }
}

Future<Uint8List> _png() async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(const Rect.fromLTWH(0,0,32,32),Paint()..color=Colors.teal);
  final image = await recorder.endRecording().toImage(32,32);
  final data = await image.toByteData(format:ui.ImageByteFormat.png);
  image.dispose();
  return data!.buffer.asUint8List();
}

void main() {
  testWidgets('photo upload survives a new provider session, isolates accounts and can be removed', (tester) async {
    final bytes = await _png();
    final client = _PhotoClient(bytes);
    AppUser user(String id) => AppUser(id:id,username:id,fullName:id,companyId:'company');
    Widget screen(String id) => ProviderScope(key:ValueKey(id),overrides:[
      currentUserProvider.overrideWithValue(user(id)),
      apiClientProvider.overrideWithValue(client),
      userPhotoPickerProvider.overrideWithValue(() async => PickedFile(name:'synthetic.png',bytes:bytes,mimeType:'image/png')),
    ],child:wrapWithApp(child:const Scaffold(body:UserPhotoCard())));

    await tester.pumpWidget(screen('one'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('user-photo-remove')),findsNothing);
    await tester.tap(find.byKey(const Key('user-photo-upload')));
    await tester.pumpAndSettle();
    expect(client.photos.keys,['one']);
    expect(find.byKey(const Key('user-photo-remove')),findsOneWidget);
    // A completely fresh provider scope simulates a restored user interface;
    // the fake server retains the photo, not the UI provider.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(screen('two'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('user-photo-remove')),findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(screen('one'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('user-photo-remove')),findsOneWidget);
    await tester.tap(find.byKey(const Key('user-photo-remove')));
    await tester.pumpAndSettle();
    expect(client.photos,isEmpty);
    expect(find.byKey(const Key('user-photo-remove')),findsNothing);
  });
}
