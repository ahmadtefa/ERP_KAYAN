import 'package:erp_kayan/shared/widgets/state_views.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  Widget subject(AsyncValue<List<int>> value, {VoidCallback? onRetry}) =>
      wrapWithApp(
        child: Scaffold(
          body: AsyncStateView<List<int>>(
            value: value,
            onRetry: onRetry,
            isEmpty: (data) => data.isEmpty,
            data: (data) => Text('rows:${data.length}'),
          ),
        ),
      );

  testWidgets('shows a spinner while loading', (tester) async {
    await tester.pumpWidget(subject(const AsyncValue.loading()));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows the error state with a working retry action', (
    tester,
  ) async {
    var retried = false;
    await tester.pumpWidget(
      subject(
        AsyncValue.error(const FormatException('bad'), StackTrace.empty),
        onRetry: () => retried = true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retried, isTrue);
  });

  testWidgets('shows the empty state when the payload has no rows', (
    tester,
  ) async {
    await tester.pumpWidget(subject(const AsyncValue.data(<int>[])));
    await tester.pumpAndSettle();

    expect(find.text('No data to display'), findsOneWidget);
  });

  testWidgets('renders data when rows are present', (tester) async {
    await tester.pumpWidget(subject(const AsyncValue.data(<int>[1, 2, 3])));
    await tester.pumpAndSettle();

    expect(find.text('rows:3'), findsOneWidget);
  });
}
