import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/contracts/presentation/contracts_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());

  final posted = <String>[];

  static const _contract = <String, dynamic>{
    'id': 'k-1', 'code': 'K-1', 'titleAr': 'عقد توريد وتركيب', 'status': 'OPEN', 'contractValue': '1000000.00', 'variations': '0.00',
    'effectiveValue': '1000000.00', 'billedWork': '0.00', 'remainingWork': '1000000.00', 'advanceAmount': '100000.00', 'advanceRecovered': '0.00',
    'retentionHeld': '0.00',
  };

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/contracts') return [_contract];
    return const [];
  }

  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => {
        ..._contract,
        'claims': [
          {'id': 'c-1', 'claimNo': 1, 'claimDate': '2026-03-31', 'status': 'DRAFT', 'cumulativeWork': '200000.00', 'periodWork': '200000.00', 'advanceRecovery': '20000.00', 'retention': '10000.00'},
        ],
      };

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posted.add(path);
    return {..._contract, 'claims': <Map<String, dynamic>>[]};
  }
}

Future<_Api> _pump(WidgetTester tester, List<String> permissions) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = _Api();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(AppUser(id: 'u', username: 'u', fullName: 'User', companyId: 'c', permissions: permissions)),
      ],
      child: MaterialApp(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: ContractsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return api;
}

void main() {
  testWidgets('lists contracts and lets an approver approve a waiting claim', (tester) async {
    final api = await _pump(tester, const ['contracts.read', 'contracts.manage', 'contracts.claim.create', 'contracts.claim.approve']);
    expect(find.text('K-1'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('contract-open-K-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('claim-approve-1')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('claim-approve-1')));
    await tester.pumpAndSettle();
    expect(api.posted, ['/contracts/claims/c-1/approve']);
  });

  testWidgets('a reader sees the claim but no approve or cancel button', (tester) async {
    await _pump(tester, const ['contracts.read']);
    expect(find.byKey(const ValueKey('contract-new')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('contract-open-K-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('claim-approve-1')), findsNothing);
    expect(find.byKey(const ValueKey('claim-cancel-1')), findsNothing);
    expect(find.byKey(const ValueKey('claim-new')), findsNothing);
  });
}
