import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/app_error_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a disposed navigator does not suppress errors in its replacement', (tester) async {
    Widget app(Key key) => MaterialApp(
      key: key,
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () => showAppError(context, 'Network unavailable'),
        child: const Text('Show error'),
      ))),
    );

    await tester.pumpWidget(app(const ValueKey('first')));
    await tester.tap(find.text('Show error'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    // Dispose the entire navigator without acknowledging the dialog.
    await tester.pumpWidget(app(const ValueKey('second')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Show error'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
  });
}
