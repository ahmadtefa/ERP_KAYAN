import 'dart:typed_data';

import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The import screen's own state machine: which file is chosen, what the last
/// read said, and when the button that actually writes may be pressed. The
/// rule that matters is the last one - nothing is written until a dry run has
/// been seen - so it is checked here rather than left to a click-through.
void main() {
  group('ImportController', () {
    late ProviderContainer container;

    setUp(() {
      container = ProviderContainer();
      addTearDown(container.dispose);
    });

    PickedFile file(String name) => PickedFile(
          name: name,
          bytes: Uint8List.fromList(const [1, 2, 3]),
          mimeType: 'application/octet-stream',
        );

    ImportReport report({
      bool dryRun = true,
      int created = 1,
      int updated = 0,
      List<Map<String, dynamic>> errors = const [],
    }) =>
        ImportReport({
          'dryRun': dryRun,
          'totalRows': 5,
          'created': created,
          'updated': updated,
          'skipped': 2,
          'errors': errors,
        });

    test('choosing a kind throws away the previous result', () {
      final controller = container.read(importControllerProvider.notifier);
      controller.chooseFile(file('a.xlsx'));
      controller.succeeded(report());
      controller.chooseKind(ImportKind.items);

      final state = container.read(importControllerProvider);
      expect(state.kind, ImportKind.items);
      expect(state.file, isNull);
      expect(state.report, isNull);
    });

    test('choosing a file clears the previous failure and result', () {
      final controller = container.read(importControllerProvider.notifier);
      controller.failed('older problem');
      controller.succeeded(report());
      controller.chooseFile(file('customers.xlsx'));

      final state = container.read(importControllerProvider);
      expect(state.failure, isNull);
      expect(state.report, isNull);
      expect(state.file?.name, 'customers.xlsx');
    });

    test('a read failure keeps the file, so the person can press read again', () {
      final controller = container.read(importControllerProvider.notifier);
      controller.chooseFile(file('customers.xlsx'));
      controller.beginning();
      controller.failed('the server could not be reached');

      final state = container.read(importControllerProvider);
      expect(state.busy, isFalse);
      expect(state.file?.name, 'customers.xlsx');
      expect(state.failure, 'the server could not be reached');
    });

    test('the button that writes only appears after a clean dry run with '
        'something to write', () {
      final controller = container.read(importControllerProvider.notifier);

      controller.succeeded(report(dryRun: true, created: 2));
      expect(container.read(importControllerProvider).readyToCommit, isTrue);

      controller.succeeded(report(dryRun: true, errors: [
        {'row': 2, 'column': 'code', 'message': 'missing'},
      ]));
      expect(container.read(importControllerProvider).readyToCommit, isFalse);

      controller.succeeded(report(dryRun: true, created: 0, updated: 0));
      expect(container.read(importControllerProvider).readyToCommit, isFalse);

      controller.succeeded(report(dryRun: false, created: 2));
      expect(container.read(importControllerProvider).readyToCommit, isFalse);
    });

    test('changing the mode throws the old dry run away', () {
      final controller = container.read(importControllerProvider.notifier);
      controller.succeeded(report(dryRun: true, created: 2));
      controller.chooseMode(ImportMode.upsert);
      expect(container.read(importControllerProvider).readyToCommit, isFalse);
    });

    test('cancelling the file dialogue is not an error', () {
      final controller = container.read(importControllerProvider.notifier);
      controller.chooseFile(file('customers.xlsx'));
      controller.chooseFile(null);

      final state = container.read(importControllerProvider);
      expect(state.file, isNull);
      expect(state.failure, isNull);
    });

    test('reset returns the screen to the start', () {
      final controller = container.read(importControllerProvider.notifier);
      controller.chooseFile(file('customers.xlsx'));
      controller.failed('x');
      controller.reset();

      expect(
        container.read(importControllerProvider),
        isA<ImportState>()
            .having((s) => s.file, 'file', isNull)
            .having((s) => s.failure, 'failure', isNull),
      );
    });
  });
}
