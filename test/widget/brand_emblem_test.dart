import 'package:erp_kayan/shared/widgets/brand_emblem.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

String _assetOf(WidgetTester tester) {
  final image = tester.widget<Image>(find.byType(Image));
  return (image.image as AssetImage).assetName;
}

Future<void> _pump(
  WidgetTester tester,
  Brightness brightness, {
  bool forceLight = false,
}) {
  return tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(brightness: brightness),
      home: BrandEmblem(size: 40, forceLight: forceLight),
    ),
  );
}

void main() {
  testWidgets('light theme uses the light emblem', (tester) async {
    await _pump(tester, Brightness.light);
    expect(_assetOf(tester), BrandEmblem.lightAsset);
  });

  testWidgets('dark theme uses the dark emblem', (tester) async {
    await _pump(tester, Brightness.dark);
    expect(_assetOf(tester), BrandEmblem.darkAsset);
  });

  testWidgets('full logo follows the theme', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.dark),
        home: const BrandEmblem(size: 100, full: true),
      ),
    );
    await tester.pumpAndSettle();
    expect(_assetOf(tester), BrandEmblem.fullDarkAsset);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.light),
        home: const BrandEmblem(size: 100, full: true),
      ),
    );
    await tester.pumpAndSettle();
    expect(_assetOf(tester), BrandEmblem.fullLightAsset);
  });

  testWidgets('forceLight keeps the light emblem on a white tile', (
    tester,
  ) async {
    await _pump(tester, Brightness.dark, forceLight: true);
    expect(_assetOf(tester), BrandEmblem.lightAsset);
  });
}
