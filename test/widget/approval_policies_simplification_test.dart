import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/approval_policies_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

const _admin = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'fixture-company',
  isSuperAdmin: true,
);

class _PolicyApi extends ApiClient {
  _PolicyApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => switch (path) {
    '/admin/approvals/operations' => {
      'items': ['STOCK_TRANSFER'],
    },
    '/admin/approvals/policies' => {
      'items': [
        {
          'id': 'p1',
          'nameEn': 'Large transfers',
          'nameAr': 'تحويلات كبيرة',
          'operation': 'STOCK_TRANSFER',
          'priority': 10,
          'isActive': true,
          'levels': <Map<String, dynamic>>[],
        },
      ],
    },
    _ => const {},
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => const [];
}

void _size(WidgetTester tester) {
  tester.view.physicalSize = const Size(1500, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();


}
