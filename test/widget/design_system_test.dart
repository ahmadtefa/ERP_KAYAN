import 'package:erp_kayan/app/theme/design_tokens.dart';
import 'package:erp_kayan/shared/widgets/kpi_card.dart';
import 'package:erp_kayan/shared/widgets/page_header.dart';
import 'package:erp_kayan/shared/widgets/records_table.dart';
import 'package:erp_kayan/shared/widgets/state_views.dart';
import 'package:erp_kayan/shared/widgets/status_pill.dart';
import 'package:erp_kayan/shared/widgets/surface_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets('KpiCard shows its label, value and caption', (tester) async {
    await tester.pumpWidget(
      wrapWithApp(
        child: const Scaffold(
          body: Center(
            child: SizedBox(
              width: 260,
              child: KpiCard(
                label: 'Total sales',
                value: '150,000',
                caption: '8 invoices',
                icon: Icons.trending_up_rounded,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('Total sales'), findsOneWidget);
    expect(find.text('150,000'), findsOneWidget);
    expect(find.text('8 invoices'), findsOneWidget);
  });

  testWidgets('SurfaceCard renders its header and body', (tester) async {
    await tester.pumpWidget(
      wrapWithApp(
        child: const Scaffold(
          body: SurfaceCard(
            title: 'Cash & bank',
            subtitle: 'Balances today',
            icon: Icons.account_balance_outlined,
            child: Text('Main cash box'),
          ),
        ),
      ),
    );

    expect(find.text('Cash & bank'), findsOneWidget);
    expect(find.text('Balances today'), findsOneWidget);
    expect(find.text('Main cash box'), findsOneWidget);
  });

  testWidgets('PageHeader keeps title and actions on a narrow window', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(640, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      wrapWithApp(
        child: Scaffold(
          body: PageHeader(
            title: 'Customers',
            subtitle: 'Everyone who buys from the company',
            actions: [
              OutlinedButton(
                onPressed: () {},
                child: const Text('Export'),
              ),
              FilledButton(
                onPressed: () {},
                child: const Text('New customer'),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Customers'), findsOneWidget);
    expect(find.text('Export'), findsOneWidget);
    expect(find.text('New customer'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('EmptyView offers an optional action', (tester) async {
    var invoked = false;
    await tester.pumpWidget(
      wrapWithApp(
        child: Scaffold(
          body: EmptyView(
            message: 'No customers yet',
            action: FilledButton(
              onPressed: () => invoked = true,
              child: const Text('New customer'),
            ),
          ),
        ),
      ),
    );

    expect(find.text('No customers yet'), findsOneWidget);
    await tester.tap(find.text('New customer'));
    expect(invoked, isTrue);
  });

  testWidgets('RecordsTable renders a status column as a pill', (tester) async {
    await tester.pumpWidget(
      wrapWithApp(
        child: Scaffold(
          body: RecordsTable(
            rows: const [
              <String, dynamic>{'number': 'S-100', 'status': 'POSTED'},
            ],
            columns: [
              ColumnSpec('Number', value: (row) => row['number'] as String?),
              ColumnSpec(
                'Status',
                value: (row) => 'Posted',
                tone: (row) => toneForStatus(row['status'] as String? ?? ''),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('S-100'), findsOneWidget);
    expect(find.byType(StatusPill), findsOneWidget);
    expect(find.text('Posted'), findsOneWidget);
  });

  test('server statuses map to stable semantic tones', () {
    expect(toneForStatus('POSTED'), AppTone.success);
    expect(toneForStatus('paid'), AppTone.success);
    expect(toneForStatus('DRAFT'), AppTone.warning);
    expect(toneForStatus('PARTIALLY_PAID'), AppTone.warning);
    expect(toneForStatus('cancelled'), AppTone.danger);
    expect(toneForStatus('REVERSED'), AppTone.danger);
    expect(toneForStatus('SENT'), AppTone.info);
    expect(toneForStatus('something-else'), AppTone.neutral);
  });
}
