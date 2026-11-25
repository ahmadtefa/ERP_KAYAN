import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/features/quotations/presentation/document/quotation_document.dart';
import 'package:erp_kayan/features/quotations/presentation/widgets/quotation_document_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// A synthetic letterhead page (no real branding): blue header strip, pale
/// watermark block, blue footer band. Drawn here so the test needs no asset.
Future<Uint8List> _letterheadPng() async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(const Rect.fromLTWH(0, 0, 794, 1123), Paint()..color = Colors.white);
  canvas.drawRect(const Rect.fromLTWH(0, 0, 794, 90), Paint()..color = const Color(0xFF1A4D99));
  canvas.drawRect(const Rect.fromLTWH(200, 450, 400, 160), Paint()..color = const Color(0xFFDCE6FC));
  canvas.drawRect(const Rect.fromLTWH(0, 1040, 794, 83), Paint()..color = const Color(0xFF3377CC));
  final image = await recorder.endRecording().toImage(794, 1123);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List();
}

QuotationDocument _document() => QuotationDocument.fromJson(
      {
        'quotationNumber': 'QT-77',
        'quotationDate': '2026-11-25',
        'currency': 'EGP',
        'status': 'draft',
        'customer': {'nameEn': 'Buyer', 'nameAr': 'مشتري'},
        'design': {'backgroundId': 'bg-1', 'backgroundName': 'letterhead'},
        'tables': [
          {
            'title': 'Section',
            'subTotal': '100.0000',
            'netTotal': '100.0000',
            'lines': [
              {
                'description': 'Service',
                'unit': 'piece',
                'quantity': '1.0000',
                'unitPrice': '100.0000',
                'lineTotal': '100.0000',
              },
            ],
          },
        ],
      },
      company: const {'nameEn': 'Test Co', 'nameAr': 'شركة تجريبية'},
      language: 'en',
    );

void main() {
  Future<void> loadFonts() async {
    final loader = FontLoader('IBMPlexSansArabic');
    for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$w.ttf').readAsBytesSync())));
    }
    await loader.load();
  }

  Future<void> render(
    WidgetTester tester, {
    required Uint8List bytes,
    required bool stretch,
    required double top,
    required double bottom,
    required String shot,
    bool hideBands = true,
  }) async {
    tester.view.physicalSize = const Size(1000, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    final doc = QuotationDocument.fromJson(
      {
        'quotationNumber': 'QT-77',
        'quotationDate': '2026-11-25',
        'currency': 'EGP',
        'status': 'draft',
        'customer': {'nameEn': 'Buyer', 'nameAr': 'مشتري'},
        'design': {
          'backgroundId': 'bg-1',
          'backgroundName': 'letterhead',
          'hideHeader': hideBands,
          'hideFooter': hideBands,
          'backgroundFit': stretch ? 'stretch' : 'contain',
        },
        'tables': [
          {
            'title': 'عرض سعر توريد',
            'subTotal': '100.0000',
            'netTotal': '100.0000',
            'lines': [
              {
                'description': 'خدمة تركيب وتشغيل',
                'unit': 'قطعة',
                'quantity': '1.0000',
                'unitPrice': '100.0000',
                'lineTotal': '100.0000',
              },
            ],
          },
        ],
      },
      company: const {'nameEn': 'Test Co', 'nameAr': 'شركة تجريبية'},
      language: 'ar',
    );
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
        locale: const Locale('ar'),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: SingleChildScrollView(
              child: RepaintBoundary(
                key: key,
                child: QuotationDocumentView(
                  document: doc,
                  backgroundImage: bytes,
                  backgroundTopMm: top,
                  backgroundBottomMm: bottom,
                  backgroundStretch: stretch,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 400)));
    await tester.pump();
    expect(find.byType(Image), findsWidgets, reason: 'the sheet carries the background image');
    final fits = tester.widgetList<Image>(find.byType(Image)).map((i) => i.fit).toSet();
    expect(fits, {stretch ? BoxFit.fill : BoxFit.contain});
    await tester.runAsync(() async {
      final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage();
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      final dir = Directory(Platform.environment['KAYAN_SHOT_DIR'] ?? '${Directory.systemTemp.path}/kayan-shots')
        ..createSync(recursive: true);
      File('${dir.path}/$shot').writeAsBytesSync(data!.buffer.asUint8List());
    });
  }

  testWidgets('preview keeps the letterhead proportions by default (real fonts, full page)', (tester) async {
    await tester.runAsync(loadFonts);
    final privatePath = Platform.environment['KAYAN_BG_PREVIEW_PNG'];
    final bytes = privatePath != null && File(privatePath).existsSync()
        ? File(privatePath).readAsBytesSync()
        : (await tester.runAsync(_letterheadPng))!;
    await render(tester,
        bytes: bytes,
        stretch: false,
        top: double.tryParse(Platform.environment['KAYAN_BG_TOP_MM'] ?? '') ?? 28,
        bottom: double.tryParse(Platform.environment['KAYAN_BG_BOTTOM_MM'] ?? '') ?? 28,
        shot: 'preview-contain.png');
  });

  testWidgets('preview stretches only when the user chose it (real fonts, full page)', (tester) async {
    await tester.runAsync(loadFonts);
    final privatePath = Platform.environment['KAYAN_BG_PREVIEW_PNG'];
    final bytes = privatePath != null && File(privatePath).existsSync()
        ? File(privatePath).readAsBytesSync()
        : (await tester.runAsync(_letterheadPng))!;
    await render(tester,
        bytes: bytes,
        stretch: true,
        top: double.tryParse(Platform.environment['KAYAN_BG_TOP_MM_STRETCH'] ?? '') ?? 28,
        bottom: double.tryParse(Platform.environment['KAYAN_BG_BOTTOM_MM_STRETCH'] ?? '') ?? 28,
        shot: 'preview-stretch.png');
  });

  testWidgets('without a letterhead the sheet is plain', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: SingleChildScrollView(child: QuotationDocumentView(document: _document())))),
    );
    expect(find.byType(Image), findsNothing);
  });
}
