import 'package:erp_kayan/features/data/presentation/widgets/price_visibility_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  /// A screen with one button that opens the shared dialog and keeps the
  /// answer, so the test reads what the export actions would send.
  Widget host(void Function(Map<String, bool>?) write, {required bool canSeeCost}) {
    return wrapWithApp(
      child: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: FilledButton(
              onPressed: () async {
                write(
                  await choosePriceVisibility(
                    context,
                    arabic: false,
                    canSeeCost: canSeeCost,
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('offers both prices, and returns them as asked', (tester) async {
    Map<String, bool>? answer;
    await tester.pumpWidget(host((value) => answer = value, canSeeCost: true));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // The two options are independent: uncheck costs, keep the prices.
    await tester.tap(find.text('Show costs'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(answer, {'showSalePrice': true, 'showCost': false});
  });

  testWidgets('lets the sale price be hidden while the cost stays', (tester) async {
    Map<String, bool>? answer;
    await tester.pumpWidget(host((value) => answer = value, canSeeCost: true));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Show sale prices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(answer, {'showSalePrice': false, 'showCost': true});
  });

  testWidgets('does not offer a cost to a role that may not read one', (tester) async {
    Map<String, bool>? answer;
    await tester.pumpWidget(host((value) => answer = value, canSeeCost: false));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final costs = tester.widget<CheckboxListTile>(
      find.ancestor(of: find.text('Show costs'), matching: find.byType(CheckboxListTile)),
    );
    expect(costs.value, isFalse);
    expect(costs.onChanged, isNull, reason: 'a disabled checkbox cannot be turned on');
    expect(find.text('Your role may not view costs.'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    // Even if the server were asked nicely, nothing here can ask for costs.
    expect(answer, {'showSalePrice': true, 'showCost': false});
  });

  testWidgets('cancelling returns nothing, so no request is made', (tester) async {
    Map<String, bool>? answer;
    var called = false;
    await tester.pumpWidget(host((value) {
      called = true;
      answer = value;
    }, canSeeCost: true));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(called, isTrue);
    expect(answer, isNull);
  });
}
