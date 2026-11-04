import 'dart:async';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
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

class _UncertainReset extends ResetDataSource {
  _UncertainReset() : super(ApiClient(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore()));
  final result=Completer<ResetResult>();
  int calls=0;
  @override
  Future<ResetResult> reset({required String password,required String confirmation}) {
    calls++;
    return result.future;
  }
}

void main() {
  testWidgets('reset holds the dialog while pending and refuses a blind retry', (tester) async {
    tester.view.physicalSize=const Size(1400,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final source=_UncertainReset();
    await tester.pumpWidget(ProviderScope(overrides:[
      authControllerProvider.overrideWith(_SuperAdminController.new),
      resetDataSourceProvider.overrideWithValue(source),
      resetPreviewProvider.overrideWith((ref) async => const ResetPreview(
        companyCode:'synthetic',companyName:'Synthetic',counts:{'accounts':3},confirmationWord:'RESET'))],
      child:wrapWithApp(child:const Scaffold(body:SingleChildScrollView(child:ResetDataCard())))));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Reset program')); await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm')); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first,'synthetic-password');
    await tester.enterText(find.byType(TextField).last,'RESET');
    await tester.tap(find.widgetWithText(FilledButton,'Reset program').last); await tester.pump();
    await tester.binding.handlePopRoute(); await tester.pump();
    expect(find.text('This cannot be undone'),findsOneWidget);
    source.result.completeError(StateError('PRIVATE_RESET_DIAGNOSTIC'));
    await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_RESET_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.textContaining('operation may have completed'),findsOneWidget);
    final button=tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Reset program').last);
    expect(button.onPressed,isNull);
    expect(source.calls,1);
    expect(tester.takeException(),isNull);
  });
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
