import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/widgets/price_visibility_dialog.dart';
import 'package:erp_kayan/features/data/presentation/widgets/print_visibility_prompt.dart';
import 'package:erp_kayan/features/settings/data/print_settings_data_source.dart';
import 'package:erp_kayan/features/settings/presentation/providers/print_settings_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

const _accountant = AppUser(
  id: 'u1',
  username: 'accountant',
  fullName: 'Test Accountant',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: ['inventory.cost.read', 'sales.quotations.read'],
);

const _clerk = AppUser(
  id: 'u2',
  username: 'clerk',
  fullName: 'Test Clerk',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: ['sales.quotations.read'],
);

PrintSettings _policy({
  required bool showSalePrice,
  required bool showCost,
  bool costLocked = false,
}) =>
    PrintSettings(
      types: const [],
      settings: {
        'sales-quotation': PrintPriceSetting(
          showSalePrice: showSalePrice,
          showCost: showCost,
        ),
      },
      defaults: const PrintPriceSetting(showSalePrice: true, showCost: true),
      costLocked: costLocked,
    );

/// A screen with one button that opens the shared dialog, so a test reads
/// exactly what a print button would send.
Widget _host({
  required AppUser user,
  required Future<PrintSettings> Function() answer,
  required void Function(PrintVisibilityChoice?) write,
  void Function()? onFetched,
}) =>
    wrapWithApp(
      child: ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(user),
          // The company's policy, straight from the provider the print buttons
          // read. Counting the reads is what shows the dialog asked for it
          // instead of starting from the built-in default.
          printSettingsProvider.overrideWith((ref) async {
            onFetched?.call();
            return answer();
          }),
        ],
        child: Consumer(
          builder: (context, ref, _) => Center(
            child: FilledButton(
              onPressed: () async {
                write(
                  await promptPriceVisibility(
                    context,
                    ref,
                    typeKey: 'sales-quotation',
                    arabic: false,
                  ),
                );
              },
              child: const Text('print'),
            ),
          ),
        ),
      ),
    );

void main() {
  testWidgets(
    'the first print of a session already starts from the saved policy',
    (tester) async {
      PrintVisibilityChoice? answer;
      var fetches = 0;
      await tester.pumpWidget(
        _host(
          user: _accountant,
          answer: () async => _policy(showSalePrice: false, showCost: true),
          onFetched: () => fetches += 1,
          write: (value) => answer = value,
        ),
      );

      await tester.tap(find.text('print'));
      await tester.pumpAndSettle();

      // Nothing had read the policy before this tap, so the dialog had to ask
      // for it. That is exactly the step the screen never took before.
      expect(fetches, 1);

      final salePrice = tester.widget<CheckboxListTile>(
        find.ancestor(
          of: find.text('Show sale prices'),
          matching: find.byType(CheckboxListTile),
        ),
      );
      expect(
        salePrice.value,
        isFalse,
        reason: 'the company saved "offers print without prices"',
      );

      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(answer, isNotNull);
      expect(answer!.isOverride, isFalse, reason: 'nothing was changed');
    },
  );

  testWidgets('a caller who may not read a cost is not offered one',
      (tester) async {
    PrintVisibilityChoice? answer;
    await tester.pumpWidget(
      _host(
        user: _clerk,
        answer: () async =>
            _policy(showSalePrice: true, showCost: true, costLocked: true),
        write: (value) => answer = value,
      ),
    );

    await tester.tap(find.text('print'));
    await tester.pumpAndSettle();

    final costs = tester.widget<CheckboxListTile>(
      find.ancestor(
        of: find.text('Show costs'),
        matching: find.byType(CheckboxListTile),
      ),
    );
    expect(costs.value, isFalse);
    expect(costs.onChanged, isNull, reason: 'a locked box cannot be ticked');
    expect(find.text('Your role may not view costs.'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(answer, isNotNull);
    expect(answer!.showCost, isNull);
  });

  testWidgets('a server that cannot answer still opens the dialog',
      (tester) async {
    PrintVisibilityChoice? answer;
    await tester.pumpWidget(
      _host(
        user: _accountant,
        answer: () async => throw Exception('the server is unreachable'),
        write: (value) => answer = value,
      ),
    );

    await tester.tap(find.text('print'));
    await tester.pumpAndSettle();

    expect(find.text('Show sale prices'), findsOneWidget);
    final costs = tester.widget<CheckboxListTile>(
      find.ancestor(
        of: find.text('Show costs'),
        matching: find.byType(CheckboxListTile),
      ),
    );
    expect(costs.value, isTrue, reason: 'the built-in default prints everything');

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(answer, isNotNull);
  });
}
