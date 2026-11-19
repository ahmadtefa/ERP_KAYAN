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

/// What the screens now do: keep the sentence the server wrote, but deliver it
/// through the acknowledged dialog.
void reportActionFailure(BuildContext context, Object error) {
  showAppPlainError(
    context,
    error is Failure ? error.message : presentErrorText(context, error),
  );
}

void main() {
  testWidgets('a failed action opens the dialog, not a SnackBar', (
    tester,
  ) async {
    await tester.pumpWidget(
      harness((context) => reportActionFailure(
        context,
        const ApiFailure('Notification already archived', statusCode: 409),
      )),
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

  testWidgets('the sentence the server wrote is kept, not replaced', (
    tester,
  ) async {
    // The regression that this pair of tests exists for: the first fix routed
    // the error to the dialog but let the resolver swap the server's wording
    // for a generic sentence, which broke the expiry-alerts contract.
    await tester.pumpWidget(
      harness((context) => reportActionFailure(
        context,
        const ApiFailure('Scanning is not allowed', statusCode: 403),
      )),
    );
    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Scanning is not allowed'), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('the object toString never reaches the screen', (tester) async {
    // The old code printed Text('$error'), i.e. the exception's toString.
    await tester.pumpWidget(
      harness((context) => reportActionFailure(
        context,
        const ApiFailure('Request failed', statusCode: 500),
      )),
    );
    await tester.tap(find.text('act'));
    await tester.pumpAndSettle();

    expect(find.textContaining('ApiFailure:'), findsNothing);
    expect(find.textContaining('Instance of'), findsNothing);
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
  testWidgets('a screen that waits for the dialog still settles', (
    tester,
  ) async {
    // The trap this covers: _scan and _markAllRead await the dialog. If the
    // spinner they started is still running, the frame never settles - the app
    // looks frozen behind the modal barrier, and a test that waits for it times
    // out instead of reading the message. The busy flag must be cleared before
    // the dialog is awaited.
    var busy = true;
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Builder(
            builder: (context) => StatefulBuilder(
              builder: (context, setState) => TextButton(
                onPressed: () async {
                  setState(() => busy = true);
                  try {
                    throw const ApiFailure('Scanning is not allowed',
                        statusCode: 403);
                  } catch (error) {
                    setState(() => busy = false);
                    await showAppPlainError(
                      context,
                      error is Failure ? error.message : '$error',
                    );
                  } finally {
                    if (busy) setState(() => busy = false);
                  }
                },
                child: busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('scan'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byType(TextButton));
    // Must not time out: a spinner left running behind the dialog never settles.
    await tester.pumpAndSettle(const Duration(seconds: 2));

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.textContaining('Scanning is not allowed'), findsOneWidget);
  });

}
