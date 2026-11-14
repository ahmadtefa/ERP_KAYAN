import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'test_harness.dart';

class _ReportApi extends ApiClient {
  _ReportApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  String? requestedPath;
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    requestedPath = path;
    return {
      'items': [
        {
          'id': 'move-1',
          'movementDate': '2026-11-01',
          'direction': 'OUT',
          'quantity': '2.0000',
          'unit': 'piece',
          'value': '16.0000',
          'referenceNumber': 'SI-1',
          'itemCode': 'IT-1',
          'itemNameEn': 'Part',
          'itemNameAr': 'قطعة',
          'costCenterCode': 'OPS',
          'costCenterNameEn': 'Operations',
          'costCenterNameAr': 'التشغيل',
        },
      ],
      'totals': [
        {
          'costCenterId': 'center-1',
          'costCenterCode': 'OPS',
          'costCenterNameEn': 'Operations',
          'costCenterNameAr': 'التشغيل',
          'movementCount': 1,
          'quantityIn': '0.0000',
          'quantityOut': '2.0000',
          'valueIn': '0.0000',
          'valueOut': '16.0000',
          'netValue': '-16.0000',
        },
      ],
    };
  }
}

void main() {
  testWidgets(
    'cost-center movement report shows attributed quantity and value from the API',
    (tester) async {
      final api = _ReportApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(
              const AppUser(
                id: 'u',
                username: 'u',
                fullName: 'User',
                companyId: 'c',
                permissions: ['inventory.stock.read', 'inventory.cost.read'],
              ),
            ),
          ],
          child: wrapWithApp(child: const StockCostCenterReportScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(api.requestedPath, '/inventory/reports/cost-center-movements');
      expect(find.textContaining('OPS'), findsNWidgets(2));
      expect(find.textContaining('16.0000'), findsNWidgets(2));
      expect(find.textContaining('IT-1'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
