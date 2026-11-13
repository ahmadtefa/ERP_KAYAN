import 'dart:convert';
import 'dart:typed_data';

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
  bool loseUploadResponse = false;
  bool loseRemoveResponse = false;
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
    if (loseUploadResponse) throw StateError('SYNTHETIC_UPLOAD_DIAGNOSTIC');
    return {'updated':true};
  }
  @override
  Future<Map<String,dynamic>> delete(String path) async {
    photos.remove(Uri.parse(path).queryParameters['expectedUserId']);
    if (loseRemoveResponse) throw StateError('SYNTHETIC_REMOVE_DIAGNOSTIC');
    return {'deleted':true};
  }
}


void main() {
  testWidgets('photo upload survives a new provider session, isolates accounts and can be removed', (tester) async {
    // A synthetic PNG; normalization itself has dedicated engine tests.
    final imageBytes = base64Decode('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie3WuQkAQAwDQZW+pV8VhgsGnAuMnt3q9kYgLxoXJWhTFWnTDE4mM1Qx4BV03M90/QB30QA96QETDgAAAABJRU5ErkJggg==');
    final client = _PhotoClient(imageBytes);
    AppUser user(String id) => AppUser(id:id,username:id,fullName:id,companyId:'company');
    Widget screen(String id) => ProviderScope(key:ValueKey(id),overrides:[
      currentUserProvider.overrideWithValue(user(id)),
      apiClientProvider.overrideWithValue(client),
      userPhotoPickerProvider.overrideWithValue(() async => PickedFile(name:'synthetic.png',bytes:imageBytes,mimeType:'image/png')),
      userPhotoNormalizerProvider.overrideWithValue((source) async => source),
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
  testWidgets('photo refreshes after upload and delete commit with lost responses', (tester) async {
    final bytes = base64Decode('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie3WuQkAQAwDQZW+pV8VhgsGnAuMnt3q9kYgLxoXJWhTFWnTDE4mM1Qx4BV03M90/QB30QA96QETDgAAAABJRU5ErkJggg==');
    final client = _PhotoClient(bytes)..loseUploadResponse = true..loseRemoveResponse = true;
    await tester.pumpWidget(ProviderScope(overrides:[
      currentUserProvider.overrideWithValue(const AppUser(id:'one',username:'one',fullName:'one',companyId:'company')),
      apiClientProvider.overrideWithValue(client),
      userPhotoPickerProvider.overrideWithValue(() async => PickedFile(name:'synthetic.png',bytes:bytes,mimeType:'image/png')),
      userPhotoNormalizerProvider.overrideWithValue((source) async => source),
    ],child:wrapWithApp(child:const Scaffold(body:UserPhotoCard()))));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('user-photo-upload')));
    // Busy remains true until the error is acknowledged; its spinner cannot settle.
    await tester.pump(); await tester.pump(const Duration(seconds: 1));
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('SYNTHETIC_UPLOAD_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.byKey(const Key('user-photo-remove')),findsOneWidget);
    await tester.tap(find.byKey(const Key('user-photo-remove')));
    await tester.pump(); await tester.pump(const Duration(seconds: 1));
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('SYNTHETIC_REMOVE_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(client.photos,isEmpty);
    expect(find.byKey(const Key('user-photo-remove')),findsNothing);
    expect(tester.takeException(),isNull);
  });

}
