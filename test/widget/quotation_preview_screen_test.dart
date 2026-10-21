import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_preview_screen.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/text_scale_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _FakeCompanyProfileController extends CompanyProfileController {
  @override
  Future<Map<String, dynamic>> build() async => const <String, dynamic>{
        'id': 'company-1',
        'nameEn': 'KAYAN Integrated Solutions',
        'nameAr': 'كيان للحلول المتكاملة',
      };
}

Map<String, dynamic> _quotation() => <String, dynamic>{
      'id': 'quotation-1',
      'quotationNumber': 'QT-2026-0007',
      'quotationDate': '2026-10-19',
      'currency': 'EGP',
      'status': 'sent',
      'version': 1,
      'customer': {
        'code': 'CUS-14',
        'nameEn': 'Delta Engineering',
        'nameAr': 'دلتا للهندسة',
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
              'description': 'Rack server',
              'unit': 'piece',
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

Future<void> _pumpPreview(WidgetTester tester, Size size) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(
          AppConfig.forLocalServer('http://localhost:3000/api/v1'),
        ),
        companyProfileProvider.overrideWith(
          _FakeCompanyProfileController.new,
        ),
        effectiveTextScaleProvider.overrideWithValue(1.0),
      ],
      child: wrapWithApp(
        locale: const Locale('en'),
        child: QuotationPreviewScreen(
          quotation: _quotation(),
          language: 'en',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // The two ways out of the preview must never depend on a permission the
  // screen cannot explain: the server checks sales.quotations.export on
  // both routes and its refusal is shown as written. A preview whose
  // Download PDF button silently vanished was the reported defect.
  testWidgets('shows Print and Download PDF on a wide window', (tester) async {
    await _pumpPreview(tester, const Size(1100, 1400));

    expect(find.text('Print'), findsOneWidget);
    expect(find.text('Download PDF'), findsOneWidget);
  });

  testWidgets('shows Print and Download PDF on a narrow window', (
    tester,
  ) async {
    await _pumpPreview(tester, const Size(520, 1400));

    expect(find.text('Print'), findsOneWidget);
    expect(find.text('Download PDF'), findsOneWidget);
  });
}
