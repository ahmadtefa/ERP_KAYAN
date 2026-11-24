import 'package:erp_kayan/features/inventory/presentation/widgets/barcode_labels_dialog.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('invalid copies show their reason and disable export instead of using stale count', (tester) async {
    final unit = LabelUnitSelection(unitId: 'u', unitName: 'Box', barcode: '1234', isActive: true, selected: true);
    await tester.pumpWidget(ProviderScope(child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: BarcodeLabelsDialog(itemId: 'i', itemName: 'Cable', units: [unit])),
    )));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), '0');
    await tester.pump();
    expect(find.text('Enter a count from 1 to 500'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    expect(tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed, isNull);
    await tester.enterText(find.byType(TextFormField), '5');
    await tester.pump();
    expect(find.text('Enter a count from 1 to 500'), findsNothing);
    expect(unit.copies, 5);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNotNull);
  });
}
