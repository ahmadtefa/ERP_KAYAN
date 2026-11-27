import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/installments/presentation/installments_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());

  final deleted = <String>[];

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/installments/plans') {
      return [
        {
          'invoiceId': 'inv-1', 'invoiceNumber': 'SI-1', 'customerEn': 'Nile Co', 'customerAr': 'النيل',
          'total': 1000, 'paid': 100, 'downPayment': 100, 'count': 3, 'intervalMonths': 1, 'firstDue': '2099-01-31',
          'overdueAmount': 0, 'overdueCount': 0, 'nextDue': '2099-01-31',
          'items': [
            {'no': 1, 'dueDate': '2026-03-05', 'isDownPayment': true, 'amount': 100, 'paid': 100, 'remaining': 0, 'status': 'PAID', 'daysLate': 0},
            {'no': 2, 'dueDate': '2099-01-31', 'isDownPayment': false, 'amount': 300, 'paid': 0, 'remaining': 300, 'status': 'UPCOMING', 'daysLate': 0},
          ],
        },
      ];
    }
    if (path == '/installments/overdue') {
      return [
        {'invoiceId': 'inv-2', 'invoiceNumber': 'SI-2', 'customerEn': 'Delta', 'customerAr': 'الدلتا', 'no': 1, 'dueDate': '2026-02-10', 'remaining': 300, 'daysLate': 40},
      ];
    }
    if (path == '/sales/invoices') {
      return [
        {'id': 'inv-9', 'invoiceNumber': 'SI-9', 'invoiceDate': '2026-05-01', 'status': 'POSTED', 'documentType': 'INVOICE'},
        {'id': 'inv-8', 'invoiceNumber': 'SI-8', 'invoiceDate': '2026-05-01', 'status': 'DRAFT', 'documentType': 'INVOICE'},
      ];
    }
    return const [];
  }

  @override
  Future<Map<String, dynamic>> delete(String path) async {
    deleted.add(path);
    return {'removed': true};
  }
}

Future<_Api> _pump(WidgetTester tester, {Locale locale = const Locale('en'), List<String> permissions = const ['installments.read', 'installments.manage']}) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = _Api();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(AppUser(id: 'u', username: 'u', fullName: 'User', companyId: 'c', permissions: permissions)),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: InstallmentsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return api;
}

void main() {
  test('status words, both languages', () {
    expect(installmentStatusText('PAID', arabic: false), 'Paid');
    expect(installmentStatusText('OVERDUE', arabic: true), 'متأخر');
    expect(installmentStatusText('PARTIAL', arabic: true), 'مسدد جزئيًا');
    expect(installmentStatusText('whatever', arabic: false), 'Not due yet');
  });

  testWidgets('lists the plans and shows the schedule of one', (tester) async {
    await _pump(tester);
    expect(find.text('SI-1'), findsOneWidget);
    expect(find.text('Nile Co'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('installment-view-inv-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('installment-schedule')), findsOneWidget);
    expect(find.text('1 (down)'), findsOneWidget);
    expect(find.text('Paid'), findsWidgets);
    expect(find.text('Not due yet'), findsOneWidget);
  });

  testWidgets('the overdue view lists each late installment with its days late', (tester) async {
    await _pump(tester);
    await tester.tap(find.byKey(const ValueKey('installment-view-overdue')));
    await tester.pumpAndSettle();
    expect(find.text('SI-2'), findsOneWidget);
    expect(find.text('40'), findsOneWidget);
    expect(find.text('Delta'), findsOneWidget);
  });

  testWidgets('removing a plan asks first and then deletes only that plan', (tester) async {
    final api = await _pump(tester);
    await tester.tap(find.byKey(const ValueKey('installment-remove-inv-1')));
    await tester.pumpAndSettle();
    expect(find.text('Remove the installment plan?'), findsOneWidget);
    expect(api.deleted, isEmpty);
    await tester.tap(find.widgetWithText(FilledButton, 'Remove the plan'));
    await tester.pumpAndSettle();
    expect(api.deleted, ['/installments/invoices/inv-1']);
  });

  testWidgets('a reader without the manage permission sees no add, change or remove', (tester) async {
    await _pump(tester, permissions: const ['installments.read']);
    expect(find.byKey(const ValueKey('installment-new')), findsNothing);
    expect(find.byKey(const ValueKey('installment-edit-inv-1')), findsNothing);
    expect(find.byKey(const ValueKey('installment-remove-inv-1')), findsNothing);
    expect(find.byKey(const ValueKey('installment-view-inv-1')), findsOneWidget);
  });

  testWidgets('the new-plan form offers only posted invoices', (tester) async {
    await _pump(tester);
    await tester.tap(find.byKey(const ValueKey('installment-new')));
    await tester.pumpAndSettle();
    expect(find.text('Sales invoice (posted)'), findsOneWidget);
    expect(find.text('Number of installments (2 to 120)'), findsOneWidget);
    expect(find.text('Date of the first installment'), findsOneWidget);
  });

  testWidgets('Arabic names the screen and the columns', (tester) async {
    await _pump(tester, locale: const Locale('ar'));
    expect(find.text('أقساط العملاء'), findsOneWidget);
    expect(find.text('النيل'), findsOneWidget);
    expect(find.text('الأقساط المتأخرة'), findsOneWidget);
  });
}
