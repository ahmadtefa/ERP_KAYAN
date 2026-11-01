import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/admin/presentation/screens/admin_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
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
      '/inventory/items' => _items,
      '/admin/users' => _users,
      _ => const <Map<String, dynamic>>[],
    };
  }

  /// A face, so the picture path is drawn and not only the initial.
  ///
  /// The bytes are rendered by the test itself (see `_renderAvatarPng`), so a
  /// screenshot never depends on a file being present or on the network.
  @override
  Future<Uint8List> getBytes(String path) async {
    if (_avatarPng != null && path.startsWith('/users/')) return _avatarPng!;
    throw const ServerFailure('no photo in these screenshots');
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/items/item-water/units') {
      return <String, dynamic>{
        'item': <String, dynamic>{
          'id': 'item-water',
          'code': 'WATER-1',
          'unit': 'عبوة',
        },
        'items': _waterUnits,
      };
    }
    return const <String, dynamic>{};
  }
}

/// Mineral water: a bottle is the base unit, a carton is twelve of them. The
/// screens shown here are the ones a shopkeeper uses to say so and to sell
/// by it.
const _waterUnits = <Map<String, dynamic>>[
  <String, dynamic>{
    'id': 'unit-bottle',
    'unit': 'عبوة',
    'factor': '1.000000',
    'barcode': '6221000000011',
    'salePrice': null,
    'purchasePrice': null,
    'isBase': true,
    'isActive': true,
    'allowFraction': true,
    'usedInSales': true,
    'usedInPurchases': true,
    'sortOrder': 0,
    'abbreviation': 'عبوة',
    'perBaseSalePrice': '5.0000',
    'salePriceAgrees': true,
  },
  <String, dynamic>{
    'id': 'unit-carton',
    'unit': 'كرتونة',
    'factor': '12.000000',
    'barcode': '6221000000028',
    'salePrice': null,
    'purchasePrice': null,
    'isBase': false,
    'isActive': true,
    'allowFraction': true,
    'usedInSales': true,
    'usedInPurchases': true,
    'sortOrder': 1,
    'abbreviation': 'كرت',
    'perBaseSalePrice': '5.0000',
    'salePriceAgrees': true,
  },
];

final _items = <Map<String, dynamic>>[
  <String, dynamic>{
    'id': 'item-water',
    'code': 'WATER-1',
    'nameEn': 'Mineral water',
    'nameAr': 'مياه معدنية',
    'unit': 'عبوة',
    'barcode': '6221000000011',
    'salePrice': '5.0000',
    'purchasePrice': '4.0000',
    'taxRate': '0.0000',
    'isActive': true,
    'isStockTracked': true,
    'units': _waterUnits,
  },
  <String, dynamic>{
    'id': 'item-cable',
    'code': 'CAB-500',
    'nameEn': 'Cable reel 500 m',
    'nameAr': 'لفة كابل ٥٠٠ متر',
    'unit': 'متر',
    'barcode': null,
    'salePrice': '10.0000',
    'purchasePrice': '8.0000',
    'taxRate': '0.0000',
    'isActive': true,
    'isStockTracked': true,
    'units': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'unit-metre',
        'unit': 'متر',
        'factor': '1.000000',
        'isBase': true,
        'isActive': true,
      },
      <String, dynamic>{
        'id': 'unit-reel',
        'unit': 'لفة',
        'factor': '500.000000',
        'isBase': false,
        'isActive': true,
      },
    ],
  },
];

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

/// The people the administration screen lists: one with a picture, two
/// without, which is exactly the pair of states the avatar has to render.
final _users = <Map<String, dynamic>>[
  <String, dynamic>{
    'id': 'user-admin',
    'username': 'admin',
    'fullNameEn': 'System Manager',
    'fullNameAr': 'مدير النظام',
    'hasAvatar': true,
    'isActive': true,
    'isSuperAdmin': true,
    'roles': <Map<String, dynamic>>[
      <String, dynamic>{'code': 'ADMIN', 'nameAr': 'مدير النظام'},
    ],
    'lastLoginAt': '2026-11-01T09:15:00.000Z',
  },
  <String, dynamic>{
    'id': 'user-sales',
    'username': 'sales',
    'fullNameEn': 'Sales Clerk',
    'fullNameAr': 'موظف مبيعات',
    'hasAvatar': false,
    'isActive': true,
    'isSuperAdmin': false,
    'roles': <Map<String, dynamic>>[
      <String, dynamic>{'code': 'SALES', 'nameAr': 'مبيعات'},
    ],
    'lastLoginAt': '2026-10-30T13:40:00.000Z',
  },
  <String, dynamic>{
    'id': 'user-store',
    'username': 'store',
    'fullNameEn': 'Store Keeper',
    'fullNameAr': 'أمين المخزن',
    'hasAvatar': false,
    'isActive': false,
    'isSuperAdmin': false,
    'roles': <Map<String, dynamic>>[
      <String, dynamic>{'code': 'STORE', 'nameAr': 'المخازن'},
    ],
  },
];

/// The same administrator, but with a photo, so the signed-in face can be
/// seen in the top bar rather than only in the user list.
const _adminWithPhoto = AppUser(
  id: 'admin-1',
  username: 'admin',
  fullName: 'مدير النظام',
  companyId: 'company-1',
  branchId: 'branch-1',
  roles: ['ADMIN'],
  isSuperAdmin: true,
  hasAvatar: true,
  avatarUrl: '/users/admin-1/avatar',
);

/// A face drawn by the test: a warm head on a violet ground.
Uint8List? _avatarPng;

Future<Uint8List?> _renderAvatarPng() async {
  try {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawCircle(
      const Offset(64, 64),
      64,
      Paint()..color = const Color(0xFF6E58C8),
    );
    canvas.drawCircle(
      const Offset(64, 50),
      24,
      Paint()..color = const Color(0xFFF3D2B3),
    );
    canvas.drawCircle(
      const Offset(64, 116),
      38,
      Paint()..color = const Color(0xFFF3D2B3),
    );
    final image = await recorder.endRecording().toImage(128, 128);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  } catch (_) {
    // No rasteriser: the screen still renders, with the initial instead.
    return null;
  }
}

/// The application's own typeface, loaded before anything is rendered.
///
/// A widget test does not pick up the fonts declared in `pubspec.yaml`, and a
/// test machine has no Arabic system font: without this every glyph - Arabic,
/// Latin and icon alike - is an empty box, which is a picture of nothing. Two
/// sources are tried, the package's asset bundle and the file beside the test,
/// and the outcome is printed as a workflow notice so the run itself says
/// whether the screens are readable instead of leaving that to be guessed from
/// the pixels.
Future<int> _loadScreenFonts() async {
  const files = <String>[
    'assets/fonts/IBMPlexSansArabic-Regular.ttf',
    'assets/fonts/IBMPlexSansArabic-Medium.ttf',
    'assets/fonts/IBMPlexSansArabic-SemiBold.ttf',
    'assets/fonts/IBMPlexSansArabic-Bold.ttf',
  ];
  final loader = FontLoader('IBMPlexSansArabic');
  var added = 0;
  for (final name in files) {
    final data = await _readFontFile(name);
    if (data == null) continue;
    loader.addFont(Future.value(data));
    added += 1;
  }
  if (added == 0) return 0;
  try {
    await loader.load();
  } catch (_) {
    return 0;
  }
  return added;
}

/// The bytes of a font, from the bundle first and from disk second.
Future<ByteData?> _readFontFile(String name) async {
  try {
    return await rootBundle.load(name);
  } catch (_) {
    // Not in the bundle: the file beside the test is the other source.
  }
  for (final root in <String>[
    Directory.current.path,
    '${Directory.current.path}/..',
  ]) {
    final file = File('$root/$name');
    if (!await file.exists()) continue;
    try {
      final bytes = await file.readAsBytes();
      return ByteData.view(bytes.buffer, bytes.offsetInBytes, bytes.lengthInBytes);
    } catch (_) {
      return null;
    }
  }
  return null;
}

/// How wide a short Arabic word is in the family the app asks for.
///
/// The test font draws every glyph as a square, so four characters measure
/// exactly four times the size; the real face does not. The difference is what
/// the notice reports.
double _probeWidth(String text, String? family, FontWeight weight) {
  final painter = TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(fontFamily: family, fontSize: 20, fontWeight: weight),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  return painter.width;
}

Future<void> _tryLoadSystemFonts() async {
  var added = await _loadScreenFonts();

  if (added == 0) {
    // No bundled file could be read: register a system Arabic face under the
    // family the theme asks for, so the screens are still readable.
    const systemFiles = <String>[
      '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
      '/usr/share/fonts/truetype/fonts-noto-core/NotoNaskhArabic-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ];
    final loader = FontLoader('IBMPlexSansArabic');
    for (final path in systemFiles) {
      final file = File(path);
      if (!await file.exists()) continue;
      try {
        final bytes = await file.readAsBytes();
        loader.addFont(
          Future.value(
            ByteData.view(bytes.buffer, bytes.offsetInBytes, bytes.lengthInBytes),
          ),
        );
      } catch (_) {
        continue;
      }
      added += 1;
      break;
    }
    if (added > 0) {
      try {
        await loader.load();
      } catch (_) {
        added = 0;
      }
    }
  }

  // A font that is really there measures differently per family and per
  // weight; Ahem - the box font a widget test falls back to - draws every
  // glyph as a square, so a five-letter word measures exactly 5 x the size.
  // The run prints these numbers, so "is the screen readable?" is answered by
  // the run rather than guessed from a picture.
  final probes = <String>[];
  for (final family in <String?>[
    'IBMPlexSansArabic',
    'Ahem',
    'Noto Sans Arabic',
    'DejaVu Sans',
    null,
  ]) {
    final latin = _probeWidth('KAYAN', family, FontWeight.w400);
    final arabic = _probeWidth('كيان', family, FontWeight.w400);
    final bold = _probeWidth('KAYAN', family, FontWeight.w700);
    probes.add(
      '${family ?? 'default'} L=$latin A=$arabic B=$bold',
    );
  }
  // ignore: avoid_print
  print(
    '::notice title=Screen font::files=$added | 5x20=100 and 4x20=80 mean '
    'boxes | ${probes.join(' | ')}',
  );

  // If the theme's own family still draws squares, the screens are not worth
  // publishing: say so in the run rather than shipping pictures of nothing.
  if (_probeWidth('KAYAN', 'IBMPlexSansArabic', FontWeight.w400) >= 99.5) {
    // ignore: avoid_print
    print(
      '::warning title=Screen font::the theme family still draws boxes; '
      'the rendered screens are not readable',
    );
  }
}

Future<void> _pumpShot(
  WidgetTester tester, {
  required String route,
  required Widget child,
  Size size = const Size(1440, 900),
  Locale locale = const Locale('ar'),
  AppUser user = _adminUser,
}) async {
  tester.view.physicalSize = size;
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
        currentUserProvider.overrideWithValue(user),
        chartOfAccountsProvider.overrideWith(
          _FakeChartOfAccountsController.new,
        ),
        companyProfileProvider.overrideWith(_FakeCompanyProfileController.new),
        branchesProvider.overrideWith(_FakeBranchesController.new),
        dashboardSummaryProvider.overrideWith((ref) async => _summary),
        dashboardMonthlyProvider.overrideWith((ref) async => _monthly),
      ],
      child: MaterialApp.router(
        locale: locale,
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

  setUpAll(() async {
    await _tryLoadSystemFonts();
    _avatarPng = await _renderAvatarPng();
  });

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

  // The two pictures that answer "where do I type 12, and what does the
  // invoice say afterwards": the item's units with the carton already defined,
  // and a sales line that reads ten cartons, one hundred and twenty bottles.
  testWidgets('screenshot: the units of an item, carton of twelve (Arabic)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.items,
      // Wide enough for the row actions, which sit at the far end of a
      // horizontally scrollable table.
      size: const Size(2000, 1000),
      child: const ItemsScreen(),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/items_packing_units_ar.png'),
    );

    // The row action that opens the units of this item.
    final unitsButton = find.byIcon(Icons.qr_code_2_outlined).first;
    await tester.ensureVisible(unitsButton);
    await tester.pumpAndSettle();
    await tester.tap(unitsButton);
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/item_units_dialog_ar.png'),
    );
  });

  testWidgets('screenshot: ten cartons on a sales line (Arabic)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.salesInvoices,
      size: const Size(1600, 1000),
      child: const InvoiceEditorScreen(kind: InvoiceKind.sales),
    );

    await tester.tap(find.byType(DropdownButtonFormField<String>).at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CUS-001 — Noor Trading').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('item-choice-null')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('WATER-1 — Mineral water').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('line-unit-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('كرتونة ×12').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '10');
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/invoice_carton_line_ar.png'),
    );
  });

  // The same screen in English: the redesign has to read left-to-right as
  // well as right-to-left, and a picture is the only honest way to say so.
  testWidgets('screenshot: dashboard in English (LTR)', (tester) async {
    await _pumpShot(
      tester,
      route: AppRoutes.dashboard,
      locale: const Locale('en'),
      child: const DashboardScreen(),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/dashboard_en.png'),
    );
  });

  // One account with a photo and two without, in the same table: that is the
  // screen an administrator uses to see who has set one.
  testWidgets('screenshot: administration, people with and without photos (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.administration,
      child: const AdminScreen(),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/admin_users_ar.png'),
    );
  });

  // The signed-in person's own face in the top bar, from `/users/:id/avatar`.
  testWidgets('screenshot: the signed-in person with their own photo (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShot(
      tester,
      route: AppRoutes.dashboard,
      user: _adminWithPhoto,
      child: const DashboardScreen(),
    );
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/shell_avatar_ar.png'),
    );
  });

  // A diagnostic picture, not a screen: the same words in the theme family,
  // in a family that is not registered, and with no family at all. If the
  // first line is letters and the others are squares, the renderer is honest;
  // if all three are squares, a widget test on this machine cannot draw text
  // and the screens must be captured some other way.
  testWidgets('screenshot: what the renderer really draws (font probe)', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(900, 260));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: ColoredBox(
          color: const Color(0xFFFFFFFF),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              Text(
                'IBMPlex 0123 KAYAN كيان',
                style: TextStyle(
                  fontSize: 34,
                  fontFamily: 'IBMPlexSansArabic',
                  color: Color(0xFF111827),
                ),
              ),
              Text(
                'default 0123 KAYAN كيان',
                style: TextStyle(fontSize: 34, color: Color(0xFF111827)),
              ),
              Text(
                'bold 0123 KAYAN كيان',
                style: TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  fontFamily: 'IBMPlexSansArabic',
                  color: Color(0xFF111827),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/font_probe.png'),
    );
  });
}
