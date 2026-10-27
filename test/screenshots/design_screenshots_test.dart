import 'dart:io';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_list_screen.dart';
import 'package:erp_kayan/features/parties/presentation/screens/parties_screen.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../widget/test_harness.dart';

/// Design screenshots, rendered from the real screens.
///
/// These tests exist so a visual change can be *seen*, not just described.
/// CI runs this file with `--update-goldens` and uploads the PNGs as the
/// `design-screenshots` artifact; the same file then participates in the
/// normal test run against the freshly rendered baselines. They are
/// screenshot generators first and regression checks second — nothing here
/// is allowed to fail the build because a pixel moved.
class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(AppConfig.forLocalServer('http://screenshot.invalid'), FakeTokenStore());

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    return switch (path) {
      '/parties/customers' => _customers,
      '/sales/invoices' => _invoices,
      _ => const <Map<String, dynamic>>[],
    };
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => const <String, dynamic>{};
}

const _customers = <Map<String, dynamic>>[
  {
    'id': 'c1',
    'code': 'CUS-001',
    'nameEn': 'Noor Trading',
    'nameAr': 'شركة النور للتجارة',
    'phone': '+20 100 000 0001',
    'email': 'sales@noor.example',
    'creditLimit': '250000.0000',
    'isActive': true,
  },
  {
    'id': 'c2',
    'code': 'CUS-002',
    'nameEn': 'Delta Engineering',
    'nameAr': 'دلتا للهندسة والمقاولات',
    'phone': '+20 100 000 0002',
    'email': 'buyer@delta.example',
    'creditLimit': '500000.0000',
    'isActive': true,
  },
  {
    'id': 'c3',
    'code': 'CUS-003',
    'nameEn': 'Misr Foods',
    'nameAr': 'مصر للأغذية',
    'phone': '+20 100 000 0003',
    'email': 'orders@misr.example',
    'creditLimit': '0.0000',
    'isActive': false,
  },
];

const _invoices = <Map<String, dynamic>>[
  {
    'id': 'i1',
    'invoiceNumber': 'SI-2026-0042',
    'invoiceDate': '2026-10-12',
    'status': 'posted',
    'totalAmount': '125000.0000',
    'grossProfit': '21000.0000',
    'customer': {'nameEn': 'Noor Trading', 'nameAr': 'شركة النور للتجارة'},
  },
  {
    'id': 'i2',
    'invoiceNumber': 'SI-2026-0043',
    'invoiceDate': '2026-10-14',
    'status': 'draft',
    'totalAmount': '86400.0000',
    'grossProfit': '9800.0000',
    'customer': {'nameEn': 'Delta Engineering', 'nameAr': 'دلتا للهندسة'},
  },
  {
    'id': 'i3',
    'invoiceNumber': 'SI-2026-0044',
    'invoiceDate': '2026-10-15',
    'status': 'posted',
    'totalAmount': '43250.0000',
    'grossProfit': '6100.0000',
    'customer': {'nameEn': 'Misr Foods', 'nameAr': 'مصر للأغذية'},
  },
];

class _FakeChartOfAccountsController extends ChartOfAccountsController {
  @override
  Future<List<Account>> build() async => const [];
}

class _FakeCompanyProfileController extends CompanyProfileController {
  @override
  Future<Map<String, dynamic>> build() async => const {
    'id': 'company-1',
    'code': 'KAYAN-01',
    'nameAr': 'شركة الكيان للتجارة',
    'nameEn': 'Kayan Trading Co',
    'taxId': '300123456',
    'phone': '+20100000000',
    'email': 'info@kayan.test',
    'address': 'Cairo, Egypt',
    'hasLogo': false,
  };
}

class _FakeBranchesController extends BranchesController {
  @override
  Future<List<Map<String, dynamic>>> build() async => const [
    {
      'id': 'branch-1',
      'code': 'HQ',
      'nameAr': 'المقر الرئيسي',
      'nameEn': 'Headquarters',
      'kind': 'HEADQUARTERS',
      'isActive': true,
    },
  ];
}

const _adminUser = AppUser(
  id: 'admin-1',
  username: 'admin',
  fullName: 'مدير النظام',
  companyId: 'company-1',
  branchId: 'branch-1',
  roles: ['ADMIN'],
  isSuperAdmin: true,
);

final Json _summary = <String, dynamic>{
  'from': '2026-01-01',
  'to': '2026-10-15',
  'hasData': true,
  'documentsInPeriod': 12,
  'sales': <String, dynamic>{'total': '150000.0000', 'invoices': 8},
  'purchases': <String, dynamic>{'total': '90000.0000', 'invoices': 4},
  'receipts': <String, dynamic>{'total': '120000.0000', 'vouchers': 6},
  'payments': <String, dynamic>{'total': '70000.0000', 'vouchers': 3},
  'revenue': '160000.0000',
  'expenses': '40000.0000',
  'grossResult': '120000.0000',
  'cashPosition': '55000.0000',
  'cashAccounts': <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'ca-1',
      'code': 'CASH-1',
      'nameAr': 'الخزينة الرئيسية',
      'nameEn': 'Main cash box',
      'kind': 'CASH',
      'balance': '55000.0000',
    },
  ],
  'receivables': '30000.0000',
  'payables': '20000.0000',
  'overdue': <String, dynamic>{'total': '5000.0000', 'invoices': 1},
  'outstanding': <String, dynamic>{'total': '30000.0000', 'invoices': 3},
  'parties': <String, dynamic>{
    'customers': <String, dynamic>{'count': 12, 'active': 10},
    'suppliers': <String, dynamic>{'count': 5, 'active': 5},
  },
  'stock': <String, dynamic>{
    'value': '80000.0000',
    'itemsInStock': 40,
    'negativeBalances': 0,
    'needsReorder': 2,
  },
  'topCustomers': <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'c-1',
      'nameAr': 'شركة النور',
      'nameEn': 'Noor Co',
      'total': '60000.0000',
      'invoices': 3,
    },
  ],
  'topItems': <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'i-1',
      'nameAr': 'منتج ألف',
      'nameEn': 'Product Alpha',
      'quantity': '120.0000',
      'total': '40000.0000',
    },
  ],
  'recentDocuments': <Map<String, dynamic>>[],
};

final Json _monthly = <String, dynamic>{
  'from': '2025-11-01',
  'months': <Map<String, dynamic>>[
    for (var index = 0; index < 12; index += 1)
      <String, dynamic>{
        'month': '2026-${((index % 12) + 1).toString().padLeft(2, '0')}',
        'sales': '${(index + 1) * 1000}.0000',
        'salesCount': index + 1,
        'purchases': '${(index + 1) * 400}.0000',
        'purchasesCount': index,
        'receipts': '0.0000',
        'payments': '0.0000',
        'revenue': '${(index + 1) * 1100}.0000',
        'expenses': '${(index + 1) * 300}.0000',
        'result': '${(index + 1) * 800}.0000',
      },
  ],
};

/// The app ships no font of its own; a widget-test render would otherwise
/// draw every glyph as a box. When the machine has a real font with Arabic
/// coverage, register it so the screenshots stay readable. Absent fonts are
/// fine — layout and colour still render.
Future<void> _tryLoadSystemFonts() async {
  const candidates = <String, List<String>>{
    'NotoNaskhArabic': [
      '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
      '/usr/share/fonts/truetype/fonts-noto-core/NotoNaskhArabic-Regular.ttf',
    ],
    'DejaVuSans': [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ],
  };
  for (final entry in candidates.entries) {
    for (final path in entry.value) {
      final file = File(path);
      if (!await file.exists()) continue;
      try {
        final bytes = await file.readAsBytes();
        final loader = FontLoader(entry.key)
          ..addFont(Future.value(ByteData.view(bytes.buffer)));
        await loader.load();
      } catch (_) {
        // A font that will not load must not fail a screenshot.
      }
      break;
    }
  }
}

Future<void> _pumpShot(
  WidgetTester tester, {
  required String route,
  required Widget child,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  final router = GoRouter(
    initialLocation: route,
    routes: [
      GoRoute(
        path: route,
        builder: (context, state) =>
            ErpShell(currentPath: route, child: child),
      ),
    ],
  );

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(FakeTokenStore()),
        authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
        apiClientProvider.overrideWithValue(_FakeApiClient()),
        currentUserProvider.overrideWithValue(_adminUser),
        chartOfAccountsProvider.overrideWith(
          _FakeChartOfAccountsController.new,
        ),
        companyProfileProvider.overrideWith(_FakeCompanyProfileController.new),
        branchesProvider.overrideWith(_FakeBranchesController.new),
        dashboardSummaryProvider.overrideWith((ref) async => _summary),
        dashboardMonthlyProvider.overrideWith((ref) async => _monthly),
      ],
      child: MaterialApp.router(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: AppTheme.light(),
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(_tryLoadSystemFonts);

  testWidgets('screenshot: dashboard inside the shell (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.dashboard,
      child: const DashboardScreen(),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/dashboard_ar.png'),
    );
  });

  testWidgets('screenshot: customers section selected (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.customers,
      child: const PartiesScreen(kind: PartyKind.customer),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/customers_ar.png'),
    );
  });

  testWidgets('screenshot: sales invoices section selected (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.salesInvoices,
      child: const InvoiceListScreen(kind: InvoiceKind.sales),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/sales_invoices_ar.png'),
    );
  });
}
