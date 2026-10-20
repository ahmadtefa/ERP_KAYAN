import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_preview_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _quotation() => {
      'id': 'q-1',
      'quotationNumber': 'QT-2026-0007',
      'quotationDate': '2026-10-19',
      'currency': 'EGP',
      'status': 'sent',
      'version': 1,
      'showTaxId': true,
      'customer': {
        'code': 'CUS-14',
        'nameEn': 'Delta Engineering',
        'nameAr': 'دلتا للهندسة',
      },
      'company': {
        'nameEn': 'KAYAN Integrated Solutions',
        'nameAr': 'كيان للحلول المتكاملة',
      },
      'tables': [
        {
          'title': 'Hardware',
          'subTotal': '1000.0000',
          'discountAmount': '0.0000',
          'discountPercent': '0.0000',
          'netTotal': '1000.0000',
          'lines': [
            {
              'description': 'Rack server',
              'quantity': '2.0000',
              'unitPrice': '400.0000',
              'lineTotal': '800.0000',
            },
          ],
        },
      ],
      'totals': {
        'subTotal': '1000.0000',
        'discountTotal': '0.0000',
        'totalAmount': '1000.0000',
      },
    };

Widget _host() => ProviderScope(
      overrides: [
        // No session, no network: the screen only needs the quotation map.
        currentUserProvider.overrideWithValue(null),
      ],
      child: MaterialApp(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: QuotationPreviewScreen(
          quotation: _quotation(),
          language: 'ar',
          // The regression that hid the button for the person at the desk:
          // the exports stay on screen even when the session's permission
          // hint is false. The server still decides.
          canExport: false,
        ),
      ),
    );

void main() {
  Future<void> pumpAt(WidgetTester tester, Size size) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_host());
    await tester.pump();
  }

  void expectActionsPresent(WidgetTester tester) {
    expect(find.text('تنزيل PDF'), findsOneWidget);
    expect(find.text('طباعة'), findsOneWidget);

    final download = tester.widget<FilledButton>(
      find.byKey(QuotationPreviewScreen.downloadPdfButtonKey),
    );
    expect(download.onPressed, isNotNull);
    final print = tester.widget<TextButton>(
      find.byKey(QuotationPreviewScreen.printButtonKey),
    );
    expect(print.onPressed, isNotNull);
  }

  testWidgets('shows Print and Download PDF on a wide window', (tester) async {
    await pumpAt(tester, const Size(1100, 800));
    expectActionsPresent(tester);
  });

  testWidgets('shows Print and Download PDF on a narrow window', (tester) async {
    await pumpAt(tester, const Size(520, 800));
    expectActionsPresent(tester);
  });

  testWidgets('draws the offer sheet under the actions', (tester) async {
    await pumpAt(tester, const Size(1100, 900));
    expect(find.text('عرض سعر'), findsOneWidget);
    expect(find.text('Hardware'), findsNWidgets(2));
    expect(find.text('المجموع الكلي'), findsOneWidget);
  });
}
