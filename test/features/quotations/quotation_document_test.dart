import 'package:erp_kayan/core/image/company_logo_url.dart';
import 'package:erp_kayan/features/quotations/presentation/document/quotation_document.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> quotationJson() => {
      'id': 'q1',
      'quotationNumber': 'QT-2026-0007',
      'quotationDate': '2026-10-19',
      'validUntil': '2026-11-18',
      'currency': 'EGP',
      'status': 'sent',
      'version': 2,
      'subject': 'تجهيز غرفة الخوادم',
      'showTaxId': true,
      'terms': 'الدفع خلال 30 يومًا.\nالأسعار صالحة 30 يومًا.',
      'notes': 'التسليم في الموقع.',
      'managerName': 'م. سمير',
      'responsibleName': 'منى عادل',
      'responsiblePhone': '+20 111 222 3333',
      'customer': {'nameAr': 'عميل غير محفوظ', 'nameEn': 'Unsaved customer'},
      'contentSnapshot': {
        'quotationNumber': 'QT-2026-0007',
        'quotationDate': '2026-10-19',
        'validUntil': '2026-11-18',
        'currency': 'EGP',
        'status': 'sent',
        'version': 2,
        'subject': 'تجهيز غرفة الخوادم',
        'showTaxId': true,
        'terms': 'الدفع خلال 30 يومًا.\nالأسعار صالحة 30 يومًا.',
        'notes': 'التسليم في الموقع.',
        'managerName': 'م. سمير',
        'responsibleName': 'منى عادل',
        'responsiblePhone': '+20 111 222 3333',
        'customer': {
          'code': 'CUS-14',
          'nameEn': 'Delta Engineering',
          'nameAr': 'دلتا للهندسة',
          'phone': '+20 100 000 0000',
          'email': 'buyer@delta.example',
          'taxNumber': 'CUST-TAX-77',
          'address': 'القاهرة',
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
        'columns': [
          {
            'key': 'description',
            'labelEn': null,
            'labelAr': null,
            'visible': true,
            'width': 4,
          },
          {'key': 'unit', 'visible': true, 'width': 1},
          {'key': 'quantity', 'visible': true, 'width': 1},
          {'key': 'unitPrice', 'visible': true, 'width': 2},
          {
            'key': 'lineTotal',
            'labelAr': 'إجمالي السطر',
            'visible': true,
            'width': 2,
          },
          {'key': 'countryOfOrigin', 'visible': false, 'width': 2},
        ],
        'tables': [
          {
            'title': 'Hardware',
            'sortOrder': 1,
            'subTotal': '1000.0000',
            'discountPercent': '0.0000',
            'discountAmount': '0.0000',
            'netTotal': '1000.0000',
            'lines': [
              {
                'itemCode': 'SRV-1',
                'description': 'Rack server',
                'countryOfOrigin': 'DE',
                'unit': 'piece',
                'quantity': '2.0000',
                'unitPrice': '400.0000',
                'lineTotal': '800.0000',
              },
              {
                'itemCode': null,
                'description': 'Installation',
                'countryOfOrigin': null,
                'unit': 'service',
                'quantity': '1.0000',
                'unitPrice': '200.0000',
                'lineTotal': '200.0000',
              },
            ],
          },
          {
            'title': 'Software',
            'sortOrder': 2,
            'subTotal': '500.0000',
            'discountPercent': '10.0000',
            'discountAmount': '50.0000',
            'netTotal': '450.0000',
            'lines': [
              {
                'itemCode': 'LIC-1',
                'description': 'Annual licence',
                'countryOfOrigin': null,
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
      },
    };

void main() {
  group('QuotationDocument', () {
    test('reads the frozen snapshot, not the live record', () {
      final document = QuotationDocument.fromJson(
        quotationJson(),
        company: const {
          'nameEn': 'Live Company',
          'nameAr': 'شركة حالية',
          'logoUrl': '/companies/logo/c1?v=9',
        },
        language: 'ar',
      );

      expect(document.customer.name, 'دلتا للهندسة');
      expect(document.company.name, 'كيان للحلول المتكاملة');
      expect(document.company.secondaryName, 'KAYAN Integrated Solutions');
      expect(document.company.taxId, 'TAX-999');
      expect(document.number, 'QT-2026-0007');
      expect(document.sections, hasLength(2));
      expect(document.sections.first.rows, hasLength(2));
      expect(document.sections.first.rows[1].cell(0), 'Installation');
      expect(document.sections.first.rows[0].cell(0), 'Rack server');
    });

    test('keeps the stored money and splits the document discount once', () {
      final document = QuotationDocument.fromJson(
        quotationJson(),
        company: const {},
        language: 'ar',
      );

      expect(document.totals.subTotal, '1500.0000');
      expect(document.totals.discountTotal, '80.0000');
      expect(document.totals.tableDiscountTotal, '50.00');
      expect(document.totals.quotationDiscount, '30.00');
      expect(document.totals.totalAmount, '1420.0000');
      expect(document.sections[1].hasDiscount, isTrue);
      expect(document.sections[0].hasDiscount, isFalse);
    });

    test('drops hidden columns and honours a custom header', () {
      final document = QuotationDocument.fromJson(
        quotationJson(),
        company: const {},
        language: 'ar',
      );

      final columns = document.sections.first.columns;
      expect(columns.map((column) => column.key), [
        'description',
        'unit',
        'quantity',
        'unitPrice',
        'lineTotal',
      ]);
      expect(columns.last.label, 'إجمالي السطر');
      expect(columns[2].label, 'الكمية');
      expect(columns[2].numeric, isTrue);
    });

    test('falls back to the standard layout for a draft without columns', () {
      final document = QuotationDocument.fromJson(
        {
          'quotationNumber': 'QT-1',
          'currency': 'EGP',
          'tables': [
            {
              'title': 'Only section',
              'subTotal': '10.0000',
              'discountAmount': '0.0000',
              'netTotal': '10.0000',
              'lines': [
                {
                  'description': 'One line',
                  'quantity': '1.0000',
                  'unitPrice': '10.0000',
                  'lineTotal': '10.0000',
                  'countryOfOrigin': 'EG',
                  'unit': 'piece',
                },
              ],
            },
          ],
        },
        company: const {
          'nameEn': 'KAYAN',
          'nameAr': 'كيان',
          'address': 'Cairo',
        },
        language: 'en',
      );

      expect(document.sections.single.columns.map((column) => column.key), [
        'description',
        'countryOfOrigin',
        'unit',
        'quantity',
        'unitPrice',
        'lineTotal',
      ]);
      expect(document.company.name, 'KAYAN');
    });

  });

  group('resolveCompanyLogoUrl', () {
    test('joins the mark path to the API root, prefix included', () {
      // The server answers at /api/v1/companies/logo/:id — resolving the
      // path against the bare origin would fetch the web client instead of
      // the image, and the logo would never appear anywhere.
      expect(
        resolveCompanyLogoUrl(
          'http://localhost:3000/api/v1',
          '/companies/logo/c1?v=17',
        ),
        'http://localhost:3000/api/v1/companies/logo/c1?v=17',
      );
    });

    test('does not double a prefix the path already carries', () {
      expect(
        resolveCompanyLogoUrl(
          'http://localhost:3000/api/v1',
          '/api/v1/companies/logo/c1',
        ),
        'http://localhost:3000/api/v1/companies/logo/c1',
      );
    });

    test('keeps an absolute address unchanged', () {
      expect(
        resolveCompanyLogoUrl(
          'https://erp.example.com/api/v1',
          'https://cdn.example.com/logo.png',
        ),
        'https://cdn.example.com/logo.png',
      );
    });

    test('resolves against a bare host without inventing a prefix', () {
      expect(
        resolveCompanyLogoUrl('http://localhost:3000', '/companies/logo/c1'),
        'http://localhost:3000/companies/logo/c1',
      );
    });

    test('returns null when there is no mark', () {
      expect(resolveCompanyLogoUrl('http://localhost:3000/api/v1', null), isNull);
      expect(resolveCompanyLogoUrl('http://localhost:3000/api/v1', '  '), isNull);
    });

    test('falls back to the public endpoint when only the flag is reported', () {
      expect(
        companyLogoUrl('http://localhost:3000/api/v1', const {
          'id': 'company-1',
          'hasLogo': true,
        }),
        'http://localhost:3000/api/v1/companies/logo/company-1',
      );
      expect(
        companyLogoUrl('http://localhost:3000/api/v1', const {
          'id': 'company-1',
          'hasLogo': true,
          'updatedAt': '2026-10-20T10:00:00.000Z',
        }),
        'http://localhost:3000/api/v1/companies/logo/company-1'
        '?v=2026-10-20T10:00:00.000Z',
      );
      expect(
        companyLogoUrl('http://localhost:3000/api/v1', const {
          'id': 'company-1',
          'hasLogo': false,
        }),
        isNull,
      );
    });

    test('prefers the versioned logoUrl the server sent', () {
      expect(
        companyLogoUrl('http://lan-pc:3000/api/v1', const {
          'id': 'company-1',
          'hasLogo': true,
          'logoUrl': '/companies/logo/company-1?v=1761000000000',
          'updatedAt': 'ignored',
        }),
        'http://lan-pc:3000/api/v1/companies/logo/company-1?v=1761000000000',
      );
    });

    test('a changed logo version stamp changes the address', () {
      // The stamp is what makes a saved logo reappear immediately instead
      // of a cached copy of the old one.
      final before = companyLogoUrl('http://localhost:3000/api/v1', const {
        'id': 'company-1',
        'hasLogo': true,
        'logoUrl': '/companies/logo/company-1?v=1',
      });
      final after = companyLogoUrl('http://localhost:3000/api/v1', const {
        'id': 'company-1',
        'hasLogo': true,
        'logoUrl': '/companies/logo/company-1?v=2',
      });
      expect(before, isNot(after));
    });

    test('leaves a relative path when the base is unusable', () {
      expect(
        resolveCompanyLogoUrl('not a url', '/companies/logo/c1'),
        '/companies/logo/c1',
      );
    });
  });
}
