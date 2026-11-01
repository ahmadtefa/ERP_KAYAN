import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/shared/widgets/kayan_logo.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The owner's logo, proved rather than assumed.
///
/// The brief is exact: use the attached PNG, keep its transparency, never draw
/// a white or coloured plate behind it, never stretch it, and show it properly
/// on light and on coloured surfaces. Those are four claims about *pixels*, so
/// this file decodes the shipped asset and measures it instead of trusting the
/// file extension or a stylesheet.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('the logo file', () {
    late ui.Image image;

    setUpAll(() async {
      final bytes = await File('1.png').readAsBytes();
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      image = frame.image;
    });

    tearDownAll(() => image.dispose());

    test('is the owner’s artwork at its own size', () {
      // 3816 × 1221 is the file the owner supplied; a redrawn or re-exported
      // mark would arrive at a different size.
      expect(image.width, 3816);
      expect(image.height, 1221);
      expect(KayanLogo.aspectRatio, closeTo(image.width / image.height, 1e-9));
    });

    test('really carries an alpha channel, with empty pixels in it', () async {
      final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
      expect(data, isNotNull);
      final rgba = data!.buffer.asUint8List();
      expect(rgba.length, image.width * image.height * 4);

      var transparent = 0;
      var opaque = 0;
      // Whole rows are counted rather than sampled, so a small transparent
      // corner cannot pass for a transparent logo.
      for (var index = 3; index < rgba.length; index += 4) {
        final alpha = rgba[index];
        if (alpha == 0) transparent += 1;
        if (alpha == 255) opaque += 1;
      }
      final pixels = image.width * image.height;
      final transparentShare = transparent / pixels;
      final opaqueShare = opaque / pixels;

      // Two thirds of the sheet is empty and the mark itself is solid: that is
      // what lets the same file sit on white, on navy and on a tinted section
      // canvas. A flattened PNG (a white rectangle) would measure 0% empty.
      expect(
        transparentShare,
        greaterThan(0.6),
        reason: 'the artwork must still be mostly transparent',
      );
      expect(
        transparentShare,
        lessThan(0.85),
        reason: 'and it must still have a mark in it',
      );
      expect(
        opaqueShare,
        greaterThan(0.15),
        reason: 'the logo itself must be drawn, not a faint ghost',
      );
    });

    test('is declared as an asset, so a release build ships it', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(pubspec, contains('- 1.png'));
    });
  });

  group('the logo widget', () {
    Future<void> pump(WidgetTester tester, {required Color backdrop}) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            backgroundColor: backdrop,
            body: const Center(child: KayanLogo()),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('shows that exact file', (tester) async {
      await pump(tester, backdrop: Colors.white);
      final image = tester.widget<Image>(find.byType(Image));
      expect(image.image, isA<AssetImage>());
      expect((image.image as AssetImage).assetName, '1.png');
    });

    testWidgets('paints nothing behind it: no plate, no border, no shadow', (
      tester,
    ) async {
      await pump(tester, backdrop: AppColorsForTest.navy);
      // Every finder below is scoped to the logo itself, so the Scaffold's own
      // background cannot make this pass by accident.
      expect(
        find.descendant(
          of: find.byType(KayanLogo),
          matching: find.byType(Container),
        ),
        findsNothing,
      );
      expect(
        find.descendant(
          of: find.byType(KayanLogo),
          matching: find.byType(DecoratedBox),
        ),
        findsNothing,
      );
      expect(
        find.descendant(
          of: find.byType(KayanLogo),
          matching: find.byType(ColoredBox),
        ),
        findsNothing,
      );
      expect(
        find.descendant(
          of: find.byType(KayanLogo),
          matching: find.byType(Material),
        ),
        findsNothing,
      );
      // And nothing is placed over it either: a tint, a shadow or a padding
      // plate would all show up as widgets inside the logo.
      expect(
        find.descendant(
          of: find.byType(KayanLogo),
          matching: find.byType(Padding),
        ),
        findsNothing,
      );
    });

    testWidgets('keeps the artwork’s shape instead of forcing a square', (
      tester,
    ) async {
      await pump(tester, backdrop: Colors.white);
      final image = tester.widget<Image>(find.byType(Image));
      // Only the height is chosen; the width follows from the file's own
      // 3816 : 1221 proportion. Setting both is how it got squashed before.
      expect(image.width, isNull);
      expect(image.height, 30.0);
      expect(image.fit, BoxFit.contain);
      expect(KayanLogo.widthFor(30), closeTo(30 * 3816 / 1221, 1e-6));
    });

    testWidgets('renders on a light and on a coloured surface alike', (
      tester,
    ) async {
      for (final backdrop in <Color>[
        Colors.white,
        AppColorsForTest.navy,
        AppColorsForTest.tint,
      ]) {
        await pump(tester, backdrop: backdrop);
        expect(tester.takeException(), isNull);
        expect(find.byType(KayanLogo), findsOneWidget);
      }
    });

    testWidgets('names itself for a screen reader', (tester) async {
      final semantics = tester.ensureSemantics();
      await pump(tester, backdrop: Colors.white);
      expect(find.bySemanticsLabel('KAYAN ERP'), findsOneWidget);
      semantics.dispose();
    });
  });
}

/// The three backdrops the brief names, spelled here so the test does not
/// depend on the theme's internals.
abstract final class AppColorsForTest {
  static const navy = Color(0xFF0B1F3A);
  static const tint = Color(0xFFEAF1FE);
}
