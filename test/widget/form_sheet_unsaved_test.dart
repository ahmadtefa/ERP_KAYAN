import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/form_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
      home:Scaffold(body:Builder(builder:(context) => TextButton(onPressed:() => showFormSheet(context,title:'Edit record',
        fields:const [FieldSpec('name','Name'),FieldSpec('active','Active',kind:FieldKind.toggle)]),child:const Text('Open'))))));
    await tester.tap(find.text('Open')); await tester.pumpAndSettle();
  }
  testWidgets('cancel and system back protect text until explicit discard', (tester) async {
    await open(tester);
    await tester.enterText(find.widgetWithText(TextFormField,'Name'),'Unsaved value');
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Name')).controller!.text,'Unsaved value');
    await tester.binding.handlePopRoute(); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
    expect(find.text('Edit record'),findsNothing);
  });
  testWidgets('a changed switch is protected and an unchanged form closes directly', (tester) async {
    await open(tester);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(find.text('Edit record'),findsNothing);
    await tester.tap(find.text('Open')); await tester.pumpAndSettle();
    await tester.tap(find.byType(Switch)); await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
    expect(find.text('Edit record'),findsNothing);
  });
  testWidgets('a failed submit keeps the entered fields until a successful retry', (tester) async {
    var calls=0;
    await tester.pumpWidget(MaterialApp(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
      home:Scaffold(body:Builder(builder:(context) => TextButton(onPressed:() => showFormSheet(context,title:'Edit record',
        fields:const [FieldSpec('name','Name')],onSubmit:(values) async {
          calls++;
          if (calls == 1) throw StateError('INTERNAL_DO_NOT_SHOW');
          expect(values['name'],'Kept value');
        }),child:const Text('Open'))))));
    await tester.tap(find.text('Open')); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField,'Name'),'Kept value');
    await tester.tap(find.text('Save')); await tester.pumpAndSettle();
    expect(find.textContaining('INTERNAL_DO_NOT_SHOW'),findsNothing);
    expect(find.text('حسنًا'),findsOneWidget);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Name')).controller!.text,'Kept value');
    await tester.tap(find.text('Save')); await tester.pumpAndSettle();
    expect(calls,2); expect(find.text('Edit record'),findsNothing);
  });

  testWidgets('uncertain submission preserves the fields and blocks blind retry', (tester) async {
    var calls=0;
    await tester.pumpWidget(MaterialApp(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
      home:Scaffold(body:Builder(builder:(context) => TextButton(onPressed:() => showFormSheet(context,title:'Create record',
        fields:const [FieldSpec('name','Name')],onSubmit:(values) async {
          calls++;
          throw UncertainFormSubmission(StateError('PRIVATE_CREATE_ERROR'));
        }),child:const Text('Open'))))));
    await tester.tap(find.text('Open')); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField,'Name'),'Original draft');
    await tester.tap(find.text('Save')); await tester.pumpAndSettle();
    expect(find.textContaining('PRIVATE_CREATE_ERROR'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Name')).controller!.text,'Original draft');
    expect(find.textContaining('operation may have completed'),findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    await tester.binding.handlePopRoute(); await tester.pumpAndSettle();
    expect(find.textContaining('Close this form and review the list'),findsOneWidget);
    await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
    expect(find.text('Create record'),findsOneWidget);
    expect(calls,1);
  });

  testWidgets('date picker opens historical and distant future values without changing them', (tester) async {
    final year=DateTime.now().year;
    for (final date in ['${year - 20}-06-15','${year + 20}-06-15']) {
      await tester.pumpWidget(MaterialApp(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
        home:Scaffold(body:Builder(builder:(context) => TextButton(onPressed:() => showFormSheet(context,title:'Edit record',
          fields:const [FieldSpec('date','Date',kind:FieldKind.date)],initial:{'date':date}),child:const Text('Open'))))));
      await tester.tap(find.text('Open')); await tester.pumpAndSettle();
      final field=find.widgetWithText(TextFormField,'Date');
      await tester.tap(field); await tester.pumpAndSettle();
      expect(find.byType(DatePickerDialog),findsOneWidget);
      expect(tester.takeException(),isNull);
      final picker=find.byType(DatePickerDialog);
      final cancel=MaterialLocalizations.of(tester.element(picker)).cancelButtonLabel;
      await tester.tap(find.descendant(of:picker,matching:find.text(cancel))); await tester.pumpAndSettle();
      expect(tester.widget<TextFormField>(field).controller!.text,date);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    }
  });
}
