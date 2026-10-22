import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/preferences/text_scale.dart';
import 'package:erp_kayan/app/theme/text_scale.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/text_scale_provider.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/text_scale_card.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// In-memory store: the preferences plug-in has no bindings in a widget test,
/// and the point here is the controller and the scaler, not the file format.
class _MemoryTokenStore extends TokenStore {
  _MemoryTokenStore([this.storedScale = 1]);

  double storedScale;
  int saves = 0;

  @override
  Future<double> readTextScale() async => storedScale;

  @override
  Future<void> saveTextScale(double scale) async {
    saves += 1;
    storedScale = scale;
  }
}

/// The same thing the program builds: the theme's geometry and the root text
/// scaler, driven by the one stored value.
Widget _app({required double scale, required Widget home}) {
  return MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: AppTheme.light(textScale: scale),
    builder: (context, child) => applyTextScale(context, child, scale),
    home: home,
  );
}

const _sample = 'Sample body text';

double _effectiveScale(WidgetTester tester) {
  final context = tester.element(find.text(_sample));
  return MediaQuery.textScalerOf(context).scale(10) / 10;
}

/// The height of the painted line, which is what a person actually sees.
double _paintedHeight(WidgetTester tester, String text) {
  return tester.renderObject<RenderParagraph>(find.text(text)).size.height;
}

void main() {
  group('the root scaler', () {
    testWidgets('scales every piece of text, including sizes set explicitly', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          scale: 1.0,
          home: const Scaffold(
            body: Column(
              children: [
                Text(_sample),
                // A widget that never reads the TextTheme, which is most of
                // the sidebar and many labels.
                Text('Explicit', style: TextStyle(fontSize: 12)),
              ],
            ),
          ),
        ),
      );
      final atDefault = _paintedHeight(tester, 'Explicit');
      expect(_effectiveScale(tester), closeTo(1.0, 0.001));

      await tester.pumpWidget(
        _app(
          scale: 1.25,
          home: const Scaffold(
            body: Column(
              children: [
                Text(_sample),
                Text('Explicit', style: TextStyle(fontSize: 12)),
              ],
            ),
          ),
        ),
      );

      expect(_effectiveScale(tester), closeTo(1.25, 0.001));
      // The literal 12 grew too: the scaler sits above the whole tree.
      expect(
        _paintedHeight(tester, 'Explicit'),
        greaterThan(atDefault * 1.15),
      );
    });

    testWidgets('the default size leaves the text untouched', (tester) async {
      await tester.pumpWidget(
        _app(scale: 1.0, home: const Scaffold(body: Text(_sample))),
      );
      expect(_effectiveScale(tester), closeTo(1.0, 0.001));
      final scaler = MediaQuery.textScalerOf(tester.element(find.text(_sample)));
      expect(scaler.scale(12), 12);
    });

    testWidgets('applying the size again never multiplies it', (tester) async {
      // A theme rebuild with the same value must not compound: the scaler is
      // replaced, never applied on top of the previous one.
      for (final scale in [1.15, 1.15, 1.4, 1.0]) {
        await tester.pumpWidget(
          _app(scale: scale, home: const Scaffold(body: Text(_sample))),
        );
        expect(_effectiveScale(tester), closeTo(scale, 0.001));
      }
    });

    testWidgets('the platform scale is folded in once, not replaced', (
      tester,
    ) async {
      // A device that asks for 1.2, as Windows display scaling does. The
      // program's factor multiplies that; it must not discard it, and must not
      // apply itself twice either.
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(1.2)),
          child: Directionality(
            textDirection: TextDirection.ltr,
            child: Builder(
              builder: (context) => applyTextScale(
                context,
                const Text(_sample),
                1.1,
              ),
            ),
          ),
        ),
      );
      expect(_effectiveScale(tester), closeTo(1.2 * 1.1, 0.001));
    });
  });

  group('the settings control', () {
    Future<_MemoryTokenStore> pumpCard(
      WidgetTester tester, {
      double initial = 1.0,
      Locale locale = const Locale('en'),
    }) async {
      final store = _MemoryTokenStore(initial);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [tokenStoreProvider.overrideWithValue(store)],
          child: MaterialApp(
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            theme: AppTheme.light(),
            home: const Scaffold(
              body: SingleChildScrollView(child: TextScaleCard()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return store;
    }

    testWidgets('shows the stored size and every offered size', (tester) async {
      final store = await pumpCard(tester, initial: 1.15);

      expect(find.text('115%'), findsWidgets);
      expect(
        find.byType(ChoiceChip),
        findsNWidgets(kTextScaleSteps.length),
      );
      // The design's own size is a chip, not only a reset target.
      expect(find.text('100%'), findsOneWidget);
      expect(store.saves, 0);
    });

    testWidgets('the larger button saves the next size', (tester) async {
      final store = await pumpCard(tester);

      await tester.tap(find.byTooltip('Larger text'));
      await tester.pumpAndSettle();

      expect(store.saves, 1);
      expect(store.storedScale, 1.05);
      expect(find.text('105%'), findsWidgets);
    });

    testWidgets('the smaller button is disabled at the minimum', (tester) async {
      final store = await pumpCard(tester, initial: 0.9);

      final smaller = tester.widget<IconButton>(
        find.widgetWithIcon(IconButton, Icons.remove),
      );
      expect(smaller.onPressed, isNull);
      expect(store.saves, 0);

      final larger = tester.widget<IconButton>(
        find.widgetWithIcon(IconButton, Icons.add),
      );
      expect(larger.onPressed, isNotNull);
    });

    testWidgets('the larger button is disabled at the maximum', (tester) async {
      await pumpCard(tester, initial: 1.4);
      final larger = tester.widget<IconButton>(
        find.widgetWithIcon(IconButton, Icons.add),
      );
      expect(larger.onPressed, isNull);
    });

    testWidgets('a chip jumps straight to a size', (tester) async {
      final store = await pumpCard(tester);

      await tester.tap(find.widgetWithText(ChoiceChip, '140%'));
      await tester.pumpAndSettle();

      expect(store.storedScale, 1.4);
      expect(store.saves, 1);
    });

    testWidgets('reset returns to the default and is disabled there', (
      tester,
    ) async {
      final store = await pumpCard(tester, initial: 1.25);

      await tester.tap(find.text('Default size'));
      await tester.pumpAndSettle();

      expect(store.storedScale, 1.0);
      final reset = tester.widget<TextButton>(
        find.ancestor(
          of: find.text('Default size'),
          matching: find.byType(TextButton),
        ),
      );
      expect(reset.onPressed, isNull);
    });

    testWidgets('the Arabic card carries Arabic labels', (tester) async {
      await pumpCard(tester, locale: const Locale('ar'));

      expect(find.text('حجم الخط'), findsOneWidget);
      expect(find.text('الحجم الافتراضي'), findsOneWidget);
      expect(find.text('معاينة: فاتورة 1,250.00 ج.م · خصم 12.5%'), findsOneWidget);
    });
  });

  group('persistence', () {
    Widget consumerApp(_MemoryTokenStore store) {
      return ProviderScope(
        overrides: [tokenStoreProvider.overrideWithValue(store)],
        child: Consumer(
          builder: (context, ref, _) {
            final scale = ref.watch(effectiveTextScaleProvider);
            return _app(
              scale: scale,
              home: Scaffold(
                body: Column(
                  children: [
                    const Text(_sample),
                    TextButton(
                      onPressed: () =>
                          ref.read(textScaleControllerProvider.notifier).step(1),
                      child: const Text('grow'),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      );
    }

    testWidgets('the stored size is used on the next launch', (tester) async {
      await tester.pumpWidget(consumerApp(_MemoryTokenStore(1.25)));
      await tester.pumpAndSettle();

      expect(_effectiveScale(tester), closeTo(1.25, 0.001));
    });

    testWidgets('changing the size rebuilds the whole app', (tester) async {
      final store = _MemoryTokenStore(1.0);
      await tester.pumpWidget(consumerApp(store));
      await tester.pumpAndSettle();
      expect(_effectiveScale(tester), closeTo(1.0, 0.001));

      await tester.tap(find.text('grow'));
      await tester.pumpAndSettle();

      expect(_effectiveScale(tester), closeTo(1.05, 0.001));
      expect(store.saves, 1);
    });
  });
}
