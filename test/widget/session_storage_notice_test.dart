import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/session_storage_notice.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The notice is the only thing a person on `http://` sees that explains why a
/// reload signs them out. It must appear exactly when the store kept the
/// tokens in memory, and say nothing otherwise.
class _Store extends TokenStore {
  _Store({required this.volatile});

  final bool volatile;

  @override
  bool get isSessionVolatile => volatile;
}

Future<void> pumpNotice(
  WidgetTester tester, {
  required bool volatile,
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(_Store(volatile: volatile)),
        // The flag is published by the sign-in path; here it is set directly.
        volatileSessionProvider.overrideWith(
          () => _FixedSessionStorage(volatile),
        ),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: Column(
            children: [
              SessionStorageNotice(),
              Expanded(child: Center(child: Text('content'))),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FixedSessionStorage extends SessionStorageNotifier {
  _FixedSessionStorage(this.value);

  final bool value;

  @override
  bool build() => value;
}

void main() {
  testWidgets('a durable session shows nothing at all', (tester) async {
    await pumpNotice(tester, volatile: false);

    expect(find.byType(SessionStorageNotice), findsOneWidget);
    expect(find.textContaining('memory only'), findsNothing);
    expect(find.byIcon(Icons.info_outline), findsNothing);
    // It occupies no space, so the page is not shifted by an empty strip.
    expect(tester.getSize(find.byType(SessionStorageNotice)).height, 0);
  });

  testWidgets('a volatile session explains the reload in English', (
    tester,
  ) async {
    await pumpNotice(tester, volatile: true);

    expect(find.textContaining('memory only'), findsOneWidget);
    expect(find.textContaining('HTTPS'), findsOneWidget);
    expect(find.byIcon(Icons.info_outline), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('and in Arabic, right to left', (tester) async {
    await pumpNotice(tester, volatile: true, locale: const Locale('ar'));

    expect(find.textContaining('الذاكرة فقط'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the notice grows its row instead of clipping at 140%', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(800, 400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(_Store(volatile: true)),
          volatileSessionProvider.overrideWith(
            () => _FixedSessionStorage(true),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(1.4),
            ),
            child: child ?? const SizedBox.shrink(),
          ),
          home: const Scaffold(body: SessionStorageNotice()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Three lines at the largest size still fit a 400 px tall screen, and the
    // icon did not scale with the text.
    final row = tester.getSize(find.byType(Row).first);
    expect(row.height, greaterThan(18));
    expect(row.height, lessThan(400));
    expect(tester.widget<Icon>(find.byIcon(Icons.info_outline)).size, 18);
    expect(tester.takeException(), isNull);
  });
}
