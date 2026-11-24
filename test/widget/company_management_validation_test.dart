import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/company_management_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Client extends ApiClient {
  _Client()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );
  Map<String, dynamic>? sent;
  bool refuse = false;
  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {
    'id': 'company',
    'nameEn': 'Company',
    'nameAr': 'شركة',
    'email': 'old@example.com',
  };
  @override
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    sent = Map<String, dynamic>.from(body as Map);
    if (refuse) {
      throw const ApiFailure(
        'Invalid',
        statusCode: 422,
        fieldErrors: {'nameEn': 'Name already in use'},
      );
    }
    return sent!;
  }
}

void main() {
  testWidgets(
    'management profile clears optional email as null and keeps rejected input inline',
    (tester) async {
      await tester.runAsync(() async {
        final font = FontLoader('Roboto')
          ..addFont(
            Future.value(
              ByteData.sublistView(
                File('assets/fonts/IBMPlexSansArabic-Regular.ttf')
                    .readAsBytesSync(),
              ),
            ),
          );
        await font.load();
      });
      tester.view.physicalSize = const Size(1400, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final shot = GlobalKey();
      final client = _Client();
      await tester.pumpWidget(
        RepaintBoundary(
          key: shot,
          child: ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(client),
              currentUserProvider.overrideWithValue(
                const AppUser(
                  id: 'u',
                  username: 'u',
                  fullName: 'User',
                  companyId: 'company',
                  isSuperAdmin: true,
                ),
              ),
            ],
            child: wrapWithApp(
              child: const Scaffold(body: CompanyManagementPanel()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Edit company profile'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Email'),
        'bad-email',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(client.sent, isNull);
      expect(find.text('Enter a valid email'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextFormField, 'Email'), '');
      client.refuse = true;
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(client.sent!['email'], isNull);
      expect(client.sent!.containsKey('email'), isTrue);
      expect(find.text('Name already in use'), findsOneWidget);
      expect(find.text('Company'), findsWidgets);
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        final boundary =
            shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        File('${Directory.systemTemp.path}/company-management-inline.png')
            .writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    },
  );
}
