import 'dart:io';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/widgets/batch_operation_dialog.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets(
    'actual transfer dialog sends named source and target into migrated SQL',
    (tester) async {
      HttpOverrides.global = null;
      tester.view.physicalSize = const Size(1400, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = ApiClient(
        AppConfig.forLocalServer('http://127.0.0.1:3222/api/v1'),
        FakeTokenStore(),
      );
      late Map<String, dynamic> setup;
      await tester.runAsync(() async {
        setup = await api.get('/setup');
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(
              const AppUser(
                id: '33333333-3333-4333-8333-333333333333',
                username: 'test',
                fullName: 'Synthetic',
                companyId: '11111111-1111-4111-8111-111111111111',
                branchId: '22222222-2222-4222-8222-222222222222',
                permissions: ['inventory.batches.transfer'],
              ),
            ),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => showBatchOperationDialog(
                    context,
                    operation: BatchOperation.transfer,
                    batch: Map<String, dynamic>.from(setup['batch'] as Map),
                    warehouses: (setup['warehouses'] as List)
                        .map((x) => Map<String, dynamic>.from(x as Map))
                        .toList(),
                  ),
                  child: const Text('Open transfer'),
                ),
              ),
            ),
          ),
        ),
      );
      Future<void> settle() async {
        for (var i = 0; i < 8; i++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 50)),
          );
          await tester.pump(const Duration(milliseconds: 100));
        }
        await tester.pumpAndSettle();
      }

      Future<void> choose(String label, String option) async {
        await tester.tap(
          find.widgetWithText(DropdownButtonFormField<String>, label),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text(option).last);
        await settle();
      }

      await tester.tap(find.text('Open transfer'));
      await settle();
      await choose('To warehouse', 'W2 • Overflow');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '3',
      );
      await choose('Source location', 'A-01 • Aisle A shelf 1');
      await choose('Destination location (optional)', 'Z-01 • Target shelf');
      await tester.tap(find.widgetWithText(FilledButton, 'Transfer'));
      await settle();
      expect(find.byType(AlertDialog), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 6));
      expect(tester.takeException(), isNull);
    },
    skip: Platform.environment['KAYAN_TRANSFER_LOCATION_UI'] != '1',
  );
}
