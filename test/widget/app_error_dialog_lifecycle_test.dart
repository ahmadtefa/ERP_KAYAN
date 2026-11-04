import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/app_error_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('errors remain Arabic RTL and require explicit acknowledgement', (tester) async {
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () => showAppError(context, 'Network unavailable'),
        child: const Text('Show error'),
      ))),
    ));
    await tester.tap(find.text('Show error'));
    await tester.pumpAndSettle();
    expect(find.text('حدث خطأ'), findsOneWidget);
    expect(find.text('حسنًا'), findsOneWidget);
    expect(Directionality.of(tester.element(find.byType(AlertDialog))), TextDirection.rtl);
    await tester.pump(const Duration(seconds: 10));
    await tester.tapAt(const Offset(1, 1));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsNothing);
  });
  testWidgets('a mixed Arabic and technical failure does not expose internals', (tester) async {
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () => showAppError(context, 'تعذر الحفظ: Prisma SQL error', statusCode: 500),
        child: const Text('Show error'),
      ))),
    ));
    await tester.tap(find.text('Show error'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Prisma'), findsNothing);
    expect(find.textContaining('SQL'), findsNothing);
    expect(find.textContaining('تعذّر تأكيد نتيجة العملية'), findsOneWidget);
    expect(find.byType(AppErrorDialog), findsOneWidget);
    expect(find.text('حسنًا'), findsOneWidget);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
  });

  testWidgets('different concurrent errors are acknowledged in order', (tester) async {
    await tester.pumpWidget(MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () {
          showAppError(context, 'الخطأ الأول');
          showAppError(context, 'الخطأ الثاني');
        },
        child: const Text('Show both'),
      ))),
    ));
    await tester.tap(find.text('Show both'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    expect(find.text('الخطأ الأول'), findsOneWidget);
    expect(find.text('الخطأ الثاني'), findsNothing);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsOneWidget);
    expect(find.text('الخطأ الثاني'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('الخطأ الثاني'), findsOneWidget);
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byType(AppErrorDialog), findsNothing);
  });

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
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
  });
}
