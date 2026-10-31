import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/widgets/print_visibility_dialog.dart';
import 'package:erp_kayan/features/data/presentation/widgets/print_visibility_prompt.dart';
import 'package:erp_kayan/features/settings/data/print_settings_data_source.dart';
import 'package:erp_kayan/features/settings/presentation/providers/print_settings_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// The server's answer, as the screen would receive it.
class _FakePrintSettings implements PrintSettingsDataSource {
  _FakePrintSettings(this._answer);

  final PrintSettings? _answer;
  int fetches = 0;

  @override
  Future<PrintSettings> fetch() async {
    fetches += 1;
    if (_answer == null) throw Exception('the server is unreachable');
    return _answer!;
  }

  @override
  Future<PrintSettings> save(
    List<PrintPriceSetting> settings,
    List<String> keys,
  ) async => _answer!;
}

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

Widget _host({
  required AppUser user,
  required PrintSettingsDataSource source,
  required void Function(PrintVisibilityChoice?) write,
}) =>
    wrapWithApp(
      child: ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(user),
          printSettingsDataSourceProvider.overrideWithValue(source),
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
      final source = _FakePrintSettings(
        _policy(showSalePrice: false, showCost: true),
      );
      await tester.pumpWidget(
        _host(user: _accountant, source: source, write: (value) => answer = value),
      );

      await tester.tap(find.text('print'));
      await tester.pumpAndSettle();

      // The provider had not been read before this tap: the dialog had to go
      // and fetch the policy, which is exactly what the screen never did when
      // the settings page had not been opened.
      expect(source.fetches, 1);

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

  testWidgets('a caller who may not read a cost is not offered one', (tester) async {
    PrintVisibilityChoice? answer;
    final source = _FakePrintSettings(
      _policy(showSalePrice: true, showCost: true, costLocked: true),
    );
    await tester.pumpWidget(
      _host(user: _clerk, source: source, write: (value) => answer = value),
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

  testWidgets('a server that cannot answer still opens the dialog', (tester) async {
    PrintVisibilityChoice? answer;
    final source = _FakePrintSettings(null);
    await tester.pumpWidget(
      _host(user: _accountant, source: source, write: (value) => answer = value),
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
