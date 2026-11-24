import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/appearance_card.dart';
import 'package:erp_kayan/features/settings/presentation/providers/appearance_provider.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Store extends FakeTokenStore {
  final values = <String, String>{};
  @override
  Future<String?> readAppearance(String key) async => values[key];
  @override
  Future<void> saveAppearance(String key, String value) async {
    values[key] = value;
  }
}

void main() {
  testWidgets(
    'Arabic appearance choices change independently and fit compact settings',
    (tester) async {
      tester.view.physicalSize = const Size(920, 520);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(() async {
        final font = FontLoader('IBMPlexSansArabic');
        font.addFont(
          Future.value(
            ByteData.sublistView(
              File('assets/fonts/IBMPlexSansArabic-Regular.ttf')
                  .readAsBytesSync(),
            ),
          ),
        );
        await font.load();
        var dir = File(Platform.resolvedExecutable).parent;
        while (dir.path != dir.parent.path) {
          final icon = File(
            '${dir.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
          );
          if (icon.existsSync()) {
            final loader = FontLoader('MaterialIcons')
              ..addFont(
                Future.value(ByteData.sublistView(icon.readAsBytesSync())),
              );
            await loader.load();
            break;
          }
          dir = dir.parent;
        }
      });
      final store = _Store();
      final container = ProviderContainer(
        overrides: [tokenStoreProvider.overrideWithValue(store)],
      );
      addTearDown(container.dispose);
      final key = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: key,
          child: UncontrolledProviderScope(
            container: container,
            child: Consumer(
              builder: (context, ref, child) => MaterialApp(
                theme: ref.watch(appearanceProvider).value?.light == true
                    ? AppTheme.light()
                    : AppTheme.dark(),
                locale: const Locale('ar'),
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                home: const Scaffold(
                  body: Padding(
                    padding: EdgeInsets.all(24),
                    child: SingleChildScrollView(child: AppearanceCard()),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('فاتح، رمادي فاتح جدًا'));
      await tester.pumpAndSettle();
      expect(store.values['theme'], 'light');
      await tester.tap(find.text('قوائم علوية منسدلة'));
      await tester.pumpAndSettle();
      expect(store.values['navigation'], 'top');
      expect(container.read(appearanceProvider).value!.light, true);
      final path = Platform.environment['KAYAN_APPEARANCE_SHOT'];
      if (path != null) {
        await tester.runAsync(() async {
          final image =
              await (key.currentContext!.findRenderObject()!
                      as RenderRepaintBoundary)
                  .toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          File(path).writeAsBytesSync(bytes!.buffer.asUint8List());
        });
      }
      tester.view.physicalSize = const Size(375, 700);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}
