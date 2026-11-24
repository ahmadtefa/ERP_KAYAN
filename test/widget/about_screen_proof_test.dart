import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/settings_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The Material icon font ships inside the Flutter SDK; find it from the SDK
/// the test runs under instead of a fixed path. Missing font only means icon
/// glyphs render as boxes in a proof image, never a failed test.
ByteData _materialIcons() {
  final roots = <String>[];
  final env = Platform.environment['FLUTTER_ROOT'];
  if (env != null) roots.add(env);
  for (var d = File(Platform.resolvedExecutable).parent; d.path != d.parent.path; d = d.parent) {
    roots.add(d.path);
  }
  for (final root in roots) {
    final f = File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
    if (f.existsSync()) return ByteData.sublistView(f.readAsBytesSync());
  }
  return ByteData(0);
}

/// Where proof images go: KAYAN_SHOT_DIR, else a temp folder that always exists.
File _shot(String name) {
  final dir = Directory(Platform.environment['KAYAN_SHOT_DIR'] ?? '${Directory.systemTemp.path}/kayan-shots')..createSync(recursive: true);
  return File('${dir.path}/$name');
}

Future<void> _fonts() async {
  final f = FontLoader('IBMPlexSansArabic');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    f.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$w.ttf').readAsBytesSync())));
  }
  await f.load();
  final i = FontLoader('MaterialIcons')
    ..addFont(Future.value(_materialIcons()));
  await i.load();
}

void main() {
  testWidgets('About card shows the product description in full', (tester) async {
    await tester.runAsync(_fonts);
    tester.view.physicalSize = const Size(1100, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(
      key: key,
      child: ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(AppUser(
              id: 's', username: 's', fullName: 'Synthetic', companyId: 'c', permissions: [], isSuperAdmin: false)),
        ],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.dark(),
          locale: const Locale('ar'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: SettingsScreen()),
        ),
      ),
    ));
    await tester.pump(const Duration(milliseconds: 500));
    final about = find.byIcon(Icons.info_outline);
    await tester.ensureVisible(about);
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('يجمع كيان دورة العمل'), findsOneWidget);
    await tester.runAsync(() async {
      final b = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final img = await b.toImage();
      final d = await img.toByteData(format: ui.ImageByteFormat.png);
      _shot('about-screen.png').writeAsBytesSync(d!.buffer.asUint8List());
    });
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 70));
  });
}
