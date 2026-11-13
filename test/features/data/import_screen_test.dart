import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/features/data/presentation/screens/import_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _RecordingImportService extends DataService {
  _RecordingImportService() : super(Dio());

  final calls =
      <
        ({
          ImportKind kind,
          ImportMode mode,
          bool dryRun,
          bool clearBlankTaxRates,
        })
      >[];

  @override
  Future<ImportReport> import({
    required ImportKind kind,
    required PickedFile file,
    required ImportMode mode,
    required bool dryRun,
    bool clearBlankTaxRates = false,
  }) async {
    calls.add((
      kind: kind,
      mode: mode,
      dryRun: dryRun,
      clearBlankTaxRates: clearBlankTaxRates,
    ));
    return ImportReport({
      'dryRun': dryRun,
      'totalRows': 3,
      'created': 0,
      'updated': 2,
      'skipped': 1,
      'clearedBlankTaxRates': 2,
      'errors': <Object>[],
    });
  }
}

void main() {
  testWidgets(
    'item tax clearing option reaches preview and commit and shows report',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final service = _RecordingImportService();
      final container = ProviderContainer(
        overrides: [dataServiceProvider.overrideWithValue(service)],
      );
      addTearDown(container.dispose);

      final controller = container.read(importControllerProvider.notifier);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            locale: Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: ImportScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(DropdownButtonFormField<ImportKind>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Items').last);
      await tester.pumpAndSettle();
      expect(container.read(importControllerProvider).kind, ImportKind.items);
      await tester.drag(find.byType(ListView), const Offset(0, -600));
      await tester.pumpAndSettle();
      final updateMode = find.byType(RadioListTile<ImportMode>).last;
      expect(find.byType(RadioListTile<ImportMode>), findsNWidgets(2));
      await tester.ensureVisible(updateMode);
      await tester.tap(updateMode);
      await tester.pumpAndSettle();
      expect(container.read(importControllerProvider).mode, ImportMode.upsert);

      controller.chooseFile(
        PickedFile(
          name: 'items.csv',
          bytes: Uint8List.fromList('code,name_ar,taxrate\nA,صنف,\n'.codeUnits),
          mimeType: 'text/csv',
        ),
      );
      await tester.pumpAndSettle();

      final option = find.byType(CheckboxListTile);
      await tester.ensureVisible(option);
      await tester.pumpAndSettle();
      await tester.tap(option);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Read it without saving'));
      await tester.pumpAndSettle();

      expect(service.calls, hasLength(1));
      expect(service.calls.single, (
        kind: ImportKind.items,
        mode: ImportMode.upsert,
        dryRun: true,
        clearBlankTaxRates: true,
      ));
      expect(
        find.text('Existing items with blank tax set to zero'),
        findsOneWidget,
      );
      expect(find.text('2'), findsWidgets);

      await tester.ensureVisible(find.text('Import for real'));
      await tester.tap(find.text('Import for real'));
      await tester.pumpAndSettle();

      expect(service.calls, hasLength(2));
      expect(service.calls.last, (
        kind: ImportKind.items,
        mode: ImportMode.upsert,
        dryRun: false,
        clearBlankTaxRates: true,
      ));
      expect(
        find.text('Imported. The lists now hold these records.'),
        findsOneWidget,
      );
    },
  );
}
