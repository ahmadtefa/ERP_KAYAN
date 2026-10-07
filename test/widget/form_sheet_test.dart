import 'package:erp_kayan/shared/widgets/form_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  /// A screen with one button that opens the shared form sheet, and keeps
  /// whatever the sheet returns.
  Widget host(
    void Function(Map<String, dynamic>?) write,
    List<FieldSpec> fields,
  ) {
    return wrapWithApp(
      child: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: FilledButton(
              onPressed: () async {
                write(
                  await showFormSheet(
                    context,
                    title: 'Pick the roles',
                    fields: fields,
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

  const roles = FieldSpec(
    'roleIds',
    'Roles',
    kind: FieldKind.multiSelect,
    options: [
      FieldOption('r1', 'ADMIN'),
      FieldOption('r2', 'ACCOUNTANT'),
      FieldOption('r3', 'VIEWER'),
    ],
  );

  testWidgets('the choices are chips, and the chosen ones come back', (
    tester,
  ) async {
    Map<String, dynamic>? result;

    await tester.pumpWidget(
      host((value) => result = value, const [
        FieldSpec('name', 'Name', required: true),
        roles,
      ]),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.byType(FilterChip), findsNWidgets(3));

    // A required field left empty blocks the save.
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(find.text('This field is required'), findsOneWidget);
    expect(result, isNull);

    await tester.enterText(find.byType(TextFormField).first, 'Sara');
    await tester.tap(find.widgetWithText(FilterChip, 'ACCOUNTANT'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilterChip, 'VIEWER'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(result, isNotNull);
    expect(result!['name'], 'Sara');
    expect((result!['roleIds'] as List).toSet(), {'r2', 'r3'});
  });

  testWidgets('choosing nothing sends an empty list, not a missing key', (
    tester,
  ) async {
    Map<String, dynamic>? result;

    await tester.pumpWidget(
      host((value) => result = value, const [
        FieldSpec(
          'roleIds',
          'Roles',
          kind: FieldKind.multiSelect,
          options: [FieldOption('r1', 'ADMIN')],
        ),
      ]),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(result, isNotNull);
    expect(result!['roleIds'], isEmpty);
  });

  testWidgets('a choice can be undone before saving', (tester) async {
    Map<String, dynamic>? result;

    await tester.pumpWidget(
      host((value) => result = value, const [
        FieldSpec(
          'roleIds',
          'Roles',
          kind: FieldKind.multiSelect,
          options: [FieldOption('r1', 'ADMIN'), FieldOption('r2', 'VIEWER')],
        ),
      ]),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilterChip, 'ADMIN'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilterChip, 'VIEWER'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilterChip, 'ADMIN'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(result!['roleIds'], ['r2']);
  });
}
