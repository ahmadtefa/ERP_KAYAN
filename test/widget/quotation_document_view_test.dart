import 'package:erp_kayan/features/quotations/presentation/document/quotation_document.dart';
import 'package:erp_kayan/features/quotations/presentation/widgets/quotation_document_view.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _longDescription =
    'A rack server with redundant power supplies, two processors, '
    'sixty-four gigabytes of memory and a three-year on-site warranty that '
    'covers every part, including the fans and the backplane, with a four '
    'hour response time on business days.';

Map<String, dynamic> _quotation({
  String description = 'Rack server',
  bool withOptional = true,
}) =>
    {
      'quotationNumber': 'QT-2026-0007',
      'quotationDate': '2026-10-19',
      if (withOptional) 'validUntil': '2026-11-18',
      'currency': 'EGP',
      'status': 'sent',
      'version': 1,
      'showTaxId': withOptional,
      if (withOptional)
        'customer': {
          'code': 'CUS-14',
          'nameEn': 'Delta Engineering',
          'nameAr': 'دلتا للهندسة',
          'phone': '+20 100 000 0000',
          'taxNumber': 'CUST-TAX-77',
          'address': 'القاهرة',
        }
      else
        'customer': {
          'code': 'CUS-14',
          'nameEn': 'Delta Engineering',
          'nameAr': 'دلتا للهندسة',
        },
      'company': {
        'nameEn': 'KAYAN Integrated Solutions',
        'nameAr': 'كيان للحلول المتكاملة',
        'taxId': 'TAX-999',
        'commercialRegistration': 'CR-123',
        'phone': '+20 2 1234 5678',
        'email': 'sales@kayan.example',
        'address': 'Nasr City, Cairo',
        'addressAr': 'مدينة نصر، القاهرة',
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
              'itemCode': 'SRV-1',
              'description': description,
              'unit': 'piece',
              'quantity': '2.0000',
              'unitPrice': '400.0000',
              'lineTotal': '800.0000',
            },
            {
              'itemCode': null,
              'description': 'Installation',
              'unit': 'service',
              'quantity': '1.0000',
              'unitPrice': '200.0000',
              'lineTotal': '200.0000',
            },
          ],
        },
        {
          'title': 'Software',
          'subTotal': '500.0000',
          'discountAmount': '50.0000',
          'discountPercent': '10.0000',
          'netTotal': '450.0000',
          'lines': [
            {
              'itemCode': 'LIC-1',
              'description': 'Annual licence',
              'unit': 'licence',
              'quantity': '1.0000',
              'unitPrice': '500.0000',
              'lineTotal': '500.0000',
            },
          ],
        },
      ],
      'totals': {
        'subTotal': '1500.0000',
        'discountTotal': '80.0000',
        'totalAmount': '1420.0000',
      },
      if (withOptional) 'terms': 'Payment within 30 days.',
      if (withOptional) 'notes': 'Delivery to the site.',
      if (withOptional) 'managerName': 'Eng. Samir',
      if (withOptional) 'responsibleName': 'Mona Adel',
      if (withOptional) 'responsiblePhone': '+20 111 222 3333',
    };

QuotationDocument _document({String description = 'Rack server', bool withOptional = true}) =>
    QuotationDocument.fromJson(
      _quotation(description: description, withOptional: withOptional),
      company: const {
        'nameEn': 'KAYAN Integrated Solutions',
        'nameAr': 'كيان للحلول المتكاملة',
        'taxId': 'TAX-999',
        'phone': '+20 2 1234 5678',
        'email': 'sales@kayan.example',
        'addressAr': 'مدينة نصر، القاهرة',
      },
      language: 'ar',
    );

Widget _host(Widget child) => MaterialApp(
      locale: const Locale('ar'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 840,
            child: SingleChildScrollView(child: child),
          ),
        ),
      ),
    );

void main() {
  setUp(() {
    // A tall surface: the sheet is A4 shaped, not viewport shaped.
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  testWidgets('lays the offer out from the letterhead to the footer', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _host(QuotationDocumentView(document: _document())),
    );

    // The company name appears twice: the letterhead and the footer.
    expect(find.text('كيان للحلول المتكاملة'), findsNWidgets(2));
    expect(find.text('عرض سعر'), findsOneWidget);
    expect(find.text('دلتا للهندسة'), findsOneWidget);
    expect(find.text('QT-2026-0007'), findsNWidgets(2));
    expect(find.text('Hardware'), findsNWidgets(2));
    expect(find.text('Software'), findsNWidgets(2));
    expect(find.text('إجمالي القسم'), findsNWidgets(2));
    expect(find.text('خصم العرض'), findsOneWidget);
    expect(find.text('خصومات الجداول'), findsOneWidget);
    expect(find.text('1,420.00 EGP'), findsOneWidget);
    expect(find.text('مُرسل'), findsOneWidget);

    final hasRtl = tester
        .widgetList<Directionality>(find.byType(Directionality))
        .any((widget) => widget.textDirection == TextDirection.rtl);
    expect(hasRtl, isTrue);

    // The print page carries no browser chrome inside the document.
    expect(find.byType(AppBar), findsNothing);
  });

  testWidgets('does not show a fake logo tile when no company mark is available', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _host(QuotationDocumentView(document: _document())),
    );

    expect(find.byType(Image), findsNothing);
    expect(find.text('ك'), findsNothing);
  });

  testWidgets('writes a long description in full, without clipping', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _host(
        QuotationDocumentView(
          document: _document(description: _longDescription),
        ),
      ),
    );

    expect(find.text(_longDescription), findsOneWidget);
  });

  testWidgets('leaves out every block the offer does not have', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _host(
        QuotationDocumentView(
          document: _document(withOptional: false),
        ),
      ),
    );

    expect(find.text('صالح حتى'), findsNothing);
    expect(find.text('الهاتف'), findsNothing);
    expect(find.text('الرقم الضريبي'), findsNothing);
    expect(find.text('الشروط والأحكام'), findsNothing);
    expect(find.text('ملاحظات'), findsNothing);
    expect(find.text('مدير الشركة'), findsNothing);
    // The final total is still there.
    expect(find.text('1,420.00 EGP'), findsOneWidget);
  });
}
