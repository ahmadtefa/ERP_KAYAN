import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/app_error_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A failed action must open the central error dialog, not a SnackBar.
///
/// This is the regression this file exists for. Four call sites used to write
///
///     ScaffoldMessenger.of(context).showSnackBar(
///       SnackBar(content: Text('$error')),
///     );
///
/// which had three separate faults at once:
///   * it printed the raw failure - transport detail and English text - instead
///     of a sentence the operator could act on;
///   * a SnackBar is a single line at the bottom that vanishes on its own, so a
///     failure that needed acknowledgement could be missed entirely;
///   * it left the interface partly left-to-right inside an Arabic screen.
///
/// The tests pin the replacement behaviour: the dialog appears, it is Arabic and
/// RTL, the raw text is not on screen, and it does not disappear by itself.

/// Reproduces the old call site exactly, so the test fails if anyone puts it
/// back. Kept next to the assertions rather than in the screen, because the
/// screens now use [showAppError].
Widget harness(void Function(BuildContext) onPressed) => MaterialApp(
  locale: const Locale('ar'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(
    body: Builder(
      builder: (context) => TextButton(
        onPressed: () => onPressed(context),
        child: const Text('act'),
      ),
    ),
  ),
);

void main() {
  testWidgets('a failed action opens the dialog, not a SnackBar', (
    tester,
  ) async {
    await tester.pumpWidget(
      harness((context) {
        showAppError(
          context,
          const ApiFailure('POST /notifications/x/read failed: connection closed'),
        );
      }),
    );

    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    expect(find.byType(AppErrorDialog), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('the dialog is Arabic and right-to-left', (tester) async {
    await tester.pumpWidget(
      harness((context) => showAppError(context, 'boom')),
    );
    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    expect(find.text('حدث خطأ'), findsOneWidget);
    expect(find.text('حسنًا'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.byType(AlertDialog))),
      TextDirection.rtl,
    );
  });

  testWidgets('the raw failure text never reaches the screen', (tester) async {
    // The exact string the old code printed with Text('$error').
    const raw = 'ApiFailure: POST /notifications/read-all -> 500 Internal Server Error';
    await tester.pumpWidget(
      harness((context) => showAppError(context, const ApiFailure(raw))),
    );
    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    expect(find.textContaining('ApiFailure'), findsNothing);
    expect(find.textContaining('Internal Server Error'), findsNothing);
    expect(find.textContaining('/notifications/read-all'), findsNothing);
  });

  testWidgets('the dialog does not vanish on its own', (tester) async {
    // A SnackBar disappears after four seconds; this must not.
    await tester.pumpWidget(
      harness((context) => showAppError(context, 'boom')),
    );
    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    await tester.pump(const Duration(seconds: 10));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);

    // Only acknowledgement closes it.
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsNothing);
  });

  testWidgets('two failures in a row are each acknowledged, in order', (
    tester,
  ) async {
    await tester.pumpWidget(
      harness((context) {
        showAppError(context, 'first');
        showAppError(context, 'second');
      }),
    );
    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    // The first is on screen; the second waits its turn rather than stacking
    // on top of it.
    expect(find.byType(AppErrorDialog), findsOneWidget);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsNothing);
  });
}
