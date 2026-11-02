import 'package:erp_kayan/features/data/presentation/widgets/price_visibility_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  /// A screen with one button that opens the shared dialog and keeps the
  /// answer, so the test reads exactly what the export actions would send.
  ///
  /// The answer is now a choice rather than a plain map: a box that was not
  /// touched stays null, which is what tells the server "use the company's
  /// saved policy for this print type" instead of overriding it with the same
  /// value the policy already holds.
  Widget host(
    void Function(PrintVisibilityChoice?) write, {
    required bool canSeeCost,
    bool initialShowSalePrice = true,
    bool initialShowCost = true,
  }) {
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
                    initialShowSalePrice: initialShowSalePrice,
                    initialShowCost: initialShowCost,
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

  testWidgets('offers both prices, and sends only what was changed', (tester) async {
    PrintVisibilityChoice? answer;
    await tester.pumpWidget(host((value) => answer = value, canSeeCost: true));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // The two options are independent: uncheck costs, keep the prices.
    await tester.tap(find.text('Show costs'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(answer, isNotNull);
    expect(answer!.showCost, isFalse);
    // The untouched box is an instruction to keep the saved policy, not an
    // override repeating it.
    expect(answer!.showSalePrice, isNull);
    expect(answer!.isOverride, isTrue);
  });

  testWidgets('lets the sale price be hidden while the cost stays', (tester) async {
    PrintVisibilityChoice? answer;
    await tester.pumpWidget(host((value) => answer = value, canSeeCost: true));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Show sale prices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(answer, isNotNull);
    expect(answer!.showSalePrice, isFalse);
    expect(answer!.showCost, isNull);
  });

  testWidgets('starts where the saved policy put it', (tester) async {
    PrintVisibilityChoice? answer;
    await tester.pumpWidget(
      host(
        (value) => answer = value,
        canSeeCost: true,
        initialShowSalePrice: true,
        initialShowCost: false,
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final costs = tester.widget<CheckboxListTile>(
      find.ancestor(of: find.text('Show costs'), matching: find.byType(CheckboxListTile)),
    );
    expect(costs.value, isFalse, reason: 'the saved policy hid the cost');

    // Pressing Continue without touching anything must not turn that into an
    // override: the policy stays in charge.
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(answer, isNotNull);
    expect(answer!.isOverride, isFalse);
    expect(answer!.showCost, isNull);
    expect(answer!.showSalePrice, isNull);
  });

  testWidgets('does not offer a cost to a role that may not read one', (tester) async {
    PrintVisibilityChoice? answer;
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
    expect(answer, isNotNull);
    expect(answer!.showCost, isNull);
    expect(answer!.toQuery().containsKey('showCost'), isFalse);
  });

  testWidgets('cancelling returns nothing, so no request is made', (tester) async {
    PrintVisibilityChoice? answer;
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
