import 'package:erp_kayan/shared/widgets/form_sheet.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets(
    'explicit DTO constraints name all fields before submit and nullable clear sends null',
    (tester) async {
      Map<String, dynamic>? sent;
      await tester.pumpWidget(
        wrapWithApp(
          child: Scaffold(
            body: Builder(
              builder: (context) => FilledButton(
                onPressed: () => showFormSheet(
                  context,
                  title: 'Constraints',
                  fields: const [
                    FieldSpec(
                      'email',
                      'Email',
                      email: true,
                      maxLength: 200,
                      nullWhenEmpty: true,
                    ),
                    FieldSpec(
                      'password',
                      'Password',
                      minLength: 12,
                      maxLength: 200,
                    ),
                    FieldSpec(
                      'months',
                      'Months',
                      kind: FieldKind.integer,
                      minInteger: 1,
                      maxInteger: 1200,
                    ),
                  ],
                  onSubmit: (values) async {
                    sent = values;
                  },
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Email'),
        'bad',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Password'),
        'short',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Months'),
        '1201',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(sent, isNull);
      expect(find.text('Enter a valid email'), findsOneWidget);
      expect(find.text('Use at least 12 characters'), findsOneWidget);
      expect(
        find.text('Enter a whole number between 1 and 1200'),
        findsOneWidget,
      );
      await tester.enterText(find.widgetWithText(TextFormField, 'Email'), '');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Password'),
        'long-enough-password',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Months'),
        '1200',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(sent!.containsKey('email'), isTrue);
      expect(sent!['email'], isNull);
      expect(sent!['months'], '1200');
    },
  );
  testWidgets(
    'server field errors stay beside fields and preserve entered values',
    (tester) async {
      await tester.pumpWidget(
        wrapWithApp(
          child: Scaffold(
            body: Builder(
              builder: (context) => FilledButton(
                onPressed: () => showFormSheet(
                  context,
                  title: 'Edit',
                  fields: const [
                    FieldSpec('name', 'Name'),
                    FieldSpec('code', 'Code'),
                  ],
                  onSubmit: (_) async => throw const ApiFailure(
                    'Invalid',
                    statusCode: 422,
                    fieldErrors: {
                      'name': 'Name already exists',
                      'code': 'Code already exists',
                    },
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'Sara');
      await tester.enterText(find.byType(TextFormField).last, 'S1');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(find.text('Name already exists'), findsOneWidget);
      expect(find.text('Code already exists'), findsOneWidget);
      expect(find.text('Sara'), findsOneWidget);
      expect(find.text('S1'), findsOneWidget);
      expect(tester.binding.focusManager.primaryFocus?.hasFocus, isTrue);
    },
  );

  testWidgets(
    'wrapped explicit validation errors stay beside fields instead of uncertain lock',
    (tester) async {
      await tester.pumpWidget(
        wrapWithApp(
          child: Scaffold(
            body: Builder(
              builder: (context) => FilledButton(
                onPressed: () => showFormSheet(
                  context,
                  title: 'Edit',
                  fields: const [
                    FieldSpec('name', 'Name'),
                    FieldSpec('code', 'Code'),
                  ],
                  onSubmit: (_) async => throw const UncertainFormSubmission(
                    ApiFailure(
                      'Invalid',
                      statusCode: 422,
                      fieldErrors: {
                        'name': 'Name already exists',
                        'code': 'Code already exists',
                      },
                    ),
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'Sara');
      await tester.enterText(find.byType(TextFormField).last, 'S1');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(find.text('Name already exists'), findsOneWidget);
      expect(find.text('Code already exists'), findsOneWidget);
      expect(find.text('Sara'), findsOneWidget);
      expect(find.text('S1'), findsOneWidget);
      expect(tester.binding.focusManager.primaryFocus?.hasFocus, isTrue);
    },
  );

  testWidgets(
    'focuses the first invalid field and shows errors without a field separately',
    (tester) async {
      await tester.pumpWidget(
        wrapWithApp(
          child: Scaffold(
            body: Builder(
              builder: (context) => FilledButton(
                onPressed: () => showFormSheet(
                  context,
                  title: 'Edit',
                  fields: const [
                    FieldSpec('name', 'Name'),
                    FieldSpec('code', 'Code'),
                  ],
                  onSubmit: (_) async => throw const ApiFailure(
                    'Invalid',
                    statusCode: 400,
                    code: 'VALIDATION_FAILED',
                    fieldErrors: {
                      'code': 'Code is too short',
                      'lines.0.quantity':
                          'Quantity on line 1 must be at least 1',
                    },
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'Sara');
      await tester.enterText(find.byType(TextFormField).last, 'S');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(find.text('Code is too short'), findsOneWidget);
      expect(find.textContaining('Quantity on line 1'), findsOneWidget);
      expect(find.text('Sara'), findsOneWidget);
      expect(find.text('S'), findsOneWidget);
    },
  );

  testWidgets('server errors render and clear for toggles and selections', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapWithApp(
        child: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () => showFormSheet(
                context,
                title: 'Edit',
                fields: const [
                  FieldSpec('active', 'Active', kind: FieldKind.toggle),
                  FieldSpec(
                    'kind',
                    'Kind',
                    kind: FieldKind.select,
                    options: [FieldOption('one', 'Option one')],
                  ),
                  FieldSpec(
                    'roles',
                    'Roles',
                    kind: FieldKind.multiSelect,
                    options: [FieldOption('role', 'Role one')],
                  ),
                ],
                onSubmit: (_) async => throw const ApiFailure(
                  'Invalid',
                  statusCode: 422,
                  fieldErrors: {
                    'active': 'Active is invalid',
                    'kind': 'Kind is invalid',
                    'roles': 'Roles are invalid',
                  },
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(find.text('Active is invalid'), findsOneWidget);
    expect(find.text('Kind is invalid'), findsOneWidget);
    expect(find.text('Roles are invalid'), findsOneWidget);

    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    expect(find.text('Active is invalid'), findsNothing);

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Option one').last);
    await tester.pumpAndSettle();
    expect(find.text('Kind is invalid'), findsNothing);

    await tester.tap(find.widgetWithText(FilterChip, 'Role one'));
    await tester.pumpAndSettle();
    expect(find.text('Roles are invalid'), findsNothing);
  });

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
