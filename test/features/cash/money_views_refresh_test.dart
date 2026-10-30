import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/cash/presentation/providers/cash_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/parties/presentation/providers/party_providers.dart';

/// The bug this pins happened in use: a receipt saved on the cash screen did
/// not reach the customer's card or statement until the program was closed
/// and opened again. The server had the money; the screen did not ask again.
///
/// The test watches the two providers the partner views read, and proves that
/// the refresh the cash screen runs after a save really does make them fetch
/// their figures a second time.
void main() {
  testWidgets('a saved voucher makes the partner views read again', (
    tester,
  ) async {
    var customerListReads = 0;
    var statementReads = 0;

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customersProvider.overrideWith((ref) async {
            customerListReads += 1;
            return const <Json>[];
          }),
          partyStatementProvider.overrideWith((ref, path) async {
            statementReads += 1;
            return <String, dynamic>{'rows': <Json>[]};
          }),
        ],
        child: MaterialApp(
          home: Consumer(
            builder: (context, ref, _) {
              final customers = ref.watch(customersProvider);
              final statement = ref.watch(partyStatementProvider('one'));
              final loaded =
                  customers.hasValue && statement.hasValue ? 'loaded' : '...';
              return Scaffold(
                body: Column(
                  children: [
                    Text('partners $loaded'),
                    ElevatedButton(
                      // What the cash screen calls after the server confirms
                      // the voucher was saved.
                      onPressed: () => invalidateMoneyViews(ref),
                      child: const Text('voucher saved'),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(customerListReads, 1, reason: 'the list is read once at first');
    expect(statementReads, 1, reason: 'the statement is read once at first');

    await tester.tap(find.text('voucher saved'));
    await tester.pumpAndSettle();

    expect(
      customerListReads,
      2,
      reason: 'the partner list must re-read after the money moved',
    );
    expect(
      statementReads,
      2,
      reason: 'an open statement must re-read after the money moved',
    );
  });
}
