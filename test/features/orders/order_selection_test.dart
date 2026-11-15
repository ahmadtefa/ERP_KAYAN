import 'package:erp_kayan/features/orders/presentation/orders_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('only explicitly selected base quantities are returned', (tester) async {
    List<Map<String, dynamic>>? result;
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () async { result = await showDialog<List<Map<String, dynamic>>>(
          context: context,
          builder: (_) => const OrderSelectionDialog(order: {'lines': [
            {'id': 'a', 'itemNameEn': 'First', 'remainingQuantity': '5'},
            {'id': 'b', 'itemNameEn': 'Second', 'remainingQuantity': '9'},
          ]}),
        ); }, child: const Text('Open')))),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Checkbox).first);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '2.5');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(result, [{'orderLineId': 'a', 'quantity': '2.5'}]);
  });
}
