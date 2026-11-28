import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/orders/presentation/order_edit_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

class _EmptyApi extends ApiClient {
  _EmptyApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {'items': <Object>[], 'total': 0};

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {'items': <Object>[], 'total': 0};
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  branchId: 'b',
  isSuperAdmin: true,
);

Widget _app(Widget home) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: home,
);

void _size(WidgetTester tester) {
  tester.view.physicalSize = const Size(1600, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the draft editor names the part it edits', (tester) async {
    SharedPreferences.setMockInitialValues({});
    _size(tester);
    final order = <String, dynamic>{
      'id': 'order-1',
      'updatedAt': '2026-11-04T12:00:00.000Z',
      'lines': [
        {
          'id': 'line-1',
          'itemNameEn': 'Synthetic item',
          'unit': 'piece',
          'unitQuantity': '3',
          'unitPrice': '10',
          'discountPercent': '0',
          'taxRate': '0',
        },
      ],
    };
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_EmptyApi()),
          currentUserProvider.overrideWithValue(_user),
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
          ),
        ],
        child: _app(
          OrderEditScreen(kind: InvoiceKind.sales, order: order),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Items'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
