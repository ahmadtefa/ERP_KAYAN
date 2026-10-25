import 'package:erp_kayan/features/cash/presentation/widgets/voucher_details_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// The dialog an accountant opens on a saved receipt. It has to show the
/// document, the invoices it settled and the entry it wrote - the chain the
/// books promise - without asking the server for anything itself.
void main() {
  Map<String, dynamic> receipt({String amount = '500.0000'}) => <String, dynamic>{
    'id': 'v-1',
    'voucherNumber': 'RC-000008',
    'voucherDate': '2026-10-25',
    'kind': 'receipt',
    'status': 'posted',
    'amount': amount,
    'currency': 'EGP',
    'description': 'Collection of August invoices',
    'reference': 'TRF-77',
    'customer': {'code': 'C-1', 'nameEn': 'Acme', 'nameAr': 'أكمي'},
    'supplier': null,
    'cashAccount': {
      'code': '1102.B',
      'nameEn': 'Bank',
      'nameAr': 'بنك',
      'kind': 'BANK',
    },
    'allocations': <Map<String, dynamic>>[
      {
        'invoiceNumber': 'SI-000006',
        'invoiceTotal': '1000.0000',
        'amount': '300.0000',
      },
      {
        'invoiceNumber': 'SI-000007',
        'invoiceTotal': '500.0000',
        'amount': '200.0000',
      },
    ],
    'journalEntries': <Map<String, dynamic>>[
      {
        'entryNumber': 'JV-000057',
        'entryDate': '2026-10-25',
        'status': 'POSTED',
        'amount': '500.0000',
        'isReversal': false,
      },
    ],
  };

  Future<void> pump(WidgetTester tester, Map<String, dynamic> voucher) async {
    tester.view.physicalSize = const Size(900, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      wrapWithApp(
        child: Scaffold(
          body: SizedBox(
            width: 720,
            height: 480,
            child: VoucherDetailsView(voucher: voucher, onOpen: (_) {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows the partner, both invoices, the applied total and the entry', (
    tester,
  ) async {
    await pump(tester, receipt());

    expect(tester.takeException(), isNull);
    expect(find.text('Acme'), findsOneWidget);
    expect(find.text('SI-000006'), findsOneWidget);
    expect(find.text('SI-000007'), findsOneWidget);
    expect(find.text('JV-000057'), findsOneWidget);
    expect(find.textContaining('Applied 500.00'), findsOneWidget);
    // 300 + 200 is the whole 500, so nothing is left on the partner account.
    expect(find.textContaining('On account'), findsNothing);
    expect(find.textContaining('Collection of August invoices'), findsOneWidget);
    expect(find.textContaining('TRF-77'), findsOneWidget);
  });

  testWidgets('shows what stayed on account when nothing was applied', (
    tester,
  ) async {
    final voucher = receipt()..['allocations'] = <Map<String, dynamic>>[];
    await pump(tester, voucher);

    expect(
      find.textContaining('Not applied to an invoice'),
      findsOneWidget,
    );
    expect(find.textContaining('On account 500.00'), findsOneWidget);
  });

  testWidgets('says a draft has no entry yet instead of inventing one', (
    tester,
  ) async {
    final voucher = receipt()
      ..['status'] = 'draft'
      ..['journalEntries'] = <Map<String, dynamic>>[];
    await pump(tester, voucher);

    expect(
      find.text('No entry yet: the voucher is still a draft.'),
      findsOneWidget,
    );
  });

  testWidgets('marks a reversal entry beside the original', (tester) async {
    final voucher = receipt();
    voucher['journalEntries'] = <Map<String, dynamic>>[
      ...(voucher['journalEntries'] as List<Map<String, dynamic>>),
      {
        'entryNumber': 'JV-000058',
        'entryDate': '2026-10-25',
        'status': 'POSTED',
        'amount': '500.0000',
        'isReversal': true,
      },
    ];
    await pump(tester, voucher);

    expect(find.text('JV-000057'), findsOneWidget);
    expect(find.text('JV-000058'), findsOneWidget);
    expect(find.text('Original'), findsOneWidget);
    expect(find.text('Reversal'), findsOneWidget);
  });
}
