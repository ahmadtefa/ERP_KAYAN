import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/data/reset_data_source.dart';
import 'package:erp_kayan/features/settings/presentation/providers/reset_providers.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/reset_data_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Who is offered «إعادة تهيئة البرنامج» in Settings.
///
/// The reported problem was that the administrator could not find the
/// option at all. The card is the way in, so it is pinned down here: the
/// super administrator sees it — with the reset button enabled when the
/// preview says there is something to reset — and everyone else does not
/// see so much as its title. The server remains the authority either way.
class _SuperAdminController extends AuthController {
  @override
  Future<AppUser?> build() async => const AppUser(
        id: 'user-owner',
        username: 'owner',
        fullName: 'Program Owner',
        companyId: 'company-1',
        isSuperAdmin: true,
      );
}

class _PlainUserController extends AuthController {
  @override
  Future<AppUser?> build() async => const AppUser(
        id: 'user-clerk',
        username: 'clerk',
        fullName: 'Office Clerk',
        companyId: 'company-1',
        permissions: ['admin.company.manage'],
      );
}

Future<void> _pump(WidgetTester tester, {required bool superAdmin}) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(
          superAdmin ? _SuperAdminController.new : _PlainUserController.new,
        ),
        resetPreviewProvider.overrideWith(
          (ref) async => const ResetPreview(
            companyCode: 'KAYAN',
            companyName: 'Kayan',
            counts: {'accounts': 3},
            confirmationWord: 'RESET',
          ),
        ),
      ],
      child: wrapWithApp(
        child: const Scaffold(body: SingleChildScrollView(child: ResetDataCard())),
      ),
    ),
  );
}

void main() {
  testWidgets('the super administrator is offered the program reset', (
    tester,
  ) async {
    await _pump(tester, superAdmin: true);
    await tester.pumpAndSettle();

    expect(find.text('Reset program'), findsWidgets);
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Reset program'),
    );
    expect(button.onPressed, isNotNull);
  });

  testWidgets('a company manager without the flag is not offered it', (
    tester,
  ) async {
    await _pump(tester, superAdmin: false);
    await tester.pumpAndSettle();

    expect(find.text('Reset program'), findsNothing);
    expect(find.byType(Card), findsNothing);
  });
}
