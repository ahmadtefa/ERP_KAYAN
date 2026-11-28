import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/operations/operations_center_screen.dart';
import 'package:erp_kayan/features/operations/operations_registry.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _noAccessUser = AppUser(
  id: 'u-none',
  username: 'guest',
  fullName: 'Guest',
  companyId: 'company-1',
);

const _clerk = AppUser(
  id: 'u-clerk',
  username: 'clerk',
  fullName: 'Clerk',
  companyId: 'company-1',
  permissions: ['sales.invoices.read', 'sales.invoices.create'],
);

Future<void> _pump(
  WidgetTester tester, {
  required AppUser user,
  required OpsKind kind,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: OperationsCenterScreen(kind: kind, user: user)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('the search box has a one-line Arabic helper', (tester) async {
    await _pump(tester, user: _clerk, kind: OpsKind.entry);
    expect(
      find.text('اكتب جزءاً من اسم العملية، ثم اضغط على البطاقة لفتحها.'),
      findsOneWidget,
    );
  });

  testWidgets('no permission tells the user the next step', (tester) async {
    await _pump(tester, user: _noAccessUser, kind: OpsKind.entry);
    expect(
      find.text(
        'لا توجد لديك صلاحية لعرض عمليات هذا القسم. اطلب من مدير النظام إعطاءك الصلاحية.',
      ),
      findsOneWidget,
    );
    expect(find.text('فاتورة مبيعات جديدة'), findsNothing);
  });

  testWidgets('an empty search says what to try next', (tester) async {
    await _pump(tester, user: _clerk, kind: OpsKind.entry);
    expect(find.text('فاتورة مبيعات جديدة'), findsWidgets);
    await tester.enterText(find.byType(TextField), 'غير موجود');
    await tester.pumpAndSettle();
    expect(
      find.text('لا توجد نتائج مطابقة. جرّب كلمة أخرى أو امسح البحث.'),
      findsOneWidget,
    );
    expect(find.text('فاتورة مبيعات جديدة'), findsNothing);
  });

  testWidgets('permission filtering still hides what the user cannot open',
      (tester) async {
    await _pump(tester, user: _clerk, kind: OpsKind.entry);
    expect(find.text('فاتورة مبيعات جديدة'), findsWidgets);
    expect(find.text('فاتورة شراء جديدة'), findsNothing);
    expect(find.text('عميل جديد'), findsNothing);
  });

  test('no Arabic label or group in the registry contains Latin letters', () {
    final latin = RegExp('[A-Za-z]');
    for (final kind in OpsKind.values) {
      final items = OperationsRegistry.forKind(kind);
      expect(items, isNotEmpty);
      for (final item in items) {
        expect(latin.hasMatch(item.ar), isFalse, reason: item.id);
        expect(latin.hasMatch(item.groupAr), isFalse, reason: item.id);
      }
    }
  });
}
