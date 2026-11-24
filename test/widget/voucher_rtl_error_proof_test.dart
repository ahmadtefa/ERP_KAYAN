import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_vouchers_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final posts = <Map<String, dynamic>>[];
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {'blocked': false};
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/inventory/items') {
      return [
        {'id': 'item', 'code': 'IT', 'nameAr': 'صنف تجريبي', 'nameEn': 'Item', 'unit': 'piece'},
      ];
    }
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'warehouse', 'code': 'WH', 'nameAr': 'مخزن تجريبي', 'nameEn': 'Warehouse'},
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posts.add(Map<String, dynamic>.from(body! as Map));
    throw const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED', fieldErrors: {
      'reason': 'السبب غير مقبول لهذا النوع',
      'lines.0.unitCost': 'التكلفة يجب ألا تقل عن صفر',
    });
  }
}

Future<void> _fonts() async {
  final f = FontLoader('IBMPlexSansArabic');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    f.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$w.ttf').readAsBytesSync())));
  }
  await f.load();
  final i = FontLoader('MaterialIcons')
    ..addFont(Future.value(ByteData.sublistView(File('/tmp/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf').readAsBytesSync())));
  await i.load();
}

void main() {
  testWidgets('Arabic RTL voucher form with server field errors (render proof)', (tester) async {
    await tester.runAsync(_fonts);
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1200, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _Api();
    final shot = GlobalKey();
    const user = AppUser(id: 'u', username: 'u', fullName: 'U', companyId: 'c', branchId: 'b', isSuperAdmin: true);
    await tester.pumpWidget(RepaintBoundary(key: shot, child: ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark(),
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const StockVoucherCreateScreen(kind: 'RECEIPT'),
      ),
    )));
    await tester.pumpAndSettle();
    Future<void> pick(String label, String option) async {
      final field = find.text(label).first;
      await tester.ensureVisible(field);
      await tester.tap(field);
      await tester.pumpAndSettle();
      await tester.tap(find.text(option).last);
      await tester.pumpAndSettle();
    }
    Future<void> type(String label, String value) async {
      final field = find.widgetWithText(TextFormField, label);
      await tester.ensureVisible(field);
      await tester.enterText(field, value);
    }
    await pick('المخزن', 'WH • مخزن تجريبي');
    await type('الجهة', 'مورد تجريبي');
    await type('السبب', 'رصيد افتتاحي');
    await pick('الصنف', 'IT • صنف تجريبي');
    await type('الكمية بالوحدة الأساسية', '3');
    await type('تكلفة الوحدة الأساسية', '5');
    final save = find.byType(FilledButton).last;
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.text('السبب غير مقبول لهذا النوع'), findsOneWidget);
    expect(find.text('التكلفة يجب ألا تقل عن صفر'), findsOneWidget);
    await tester.ensureVisible(find.text('السبب غير مقبول لهذا النوع'));
    await tester.pump();
    await tester.runAsync(() async {
      final b = shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final img = await b.toImage();
      final d = await img.toByteData(format: ui.ImageByteFormat.png);
      File('/tmp/shots/voucher-ar-rtl-errors.png').writeAsBytesSync(d!.buffer.asUint8List());
    });
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 70));
  });
}
