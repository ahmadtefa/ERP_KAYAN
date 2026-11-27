import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/admin/presentation/screens/admin_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../widget/test_harness.dart';
import 'screenshot_fixtures.dart';

/// Review pictures of the administration screens: the real AdminScreen widget
/// with believable synthetic data (no backend, no real company). CI uploads
/// them from KAYAN_VISUAL_OUTPUT so a person can look at them.
class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://screenshot.invalid/api/v1'), FakeTokenStore());

  static const _roles = [
    {'id': 'r-admin', 'code': 'ADMIN', 'nameEn': 'System administrator', 'nameAr': 'مدير النظام', 'isSystem': true, 'isActive': true, 'category': 'ADMIN', 'userCount': 1, 'permissions': ['admin.users.manage', 'admin.roles.manage', 'sales.invoices.read', 'sales.invoices.write']},
    {'id': 'r-acc', 'code': 'ACCOUNTANT', 'nameEn': 'Accountant', 'nameAr': 'محاسب', 'isSystem': true, 'isActive': true, 'category': 'FINANCE', 'userCount': 2, 'permissions': ['sales.invoices.read', 'accounting.journal.read', 'accounting.journal.post']},
    {'id': 'r-sales', 'code': 'SALES', 'nameEn': 'Sales representative', 'nameAr': 'مندوب مبيعات', 'isSystem': true, 'isActive': true, 'category': 'SALES', 'userCount': 3, 'permissions': ['sales.invoices.read', 'sales.invoices.write']},
    {'id': 'r-store', 'code': 'STOREKEEPER', 'nameEn': 'Storekeeper', 'nameAr': 'أمين مخزن', 'isSystem': true, 'isActive': true, 'category': 'INVENTORY', 'userCount': 2, 'permissions': ['inventory.items.read']},
    {'id': 'r-ro', 'code': 'READ_ONLY', 'nameEn': 'Read only', 'nameAr': 'قراءة فقط', 'isSystem': true, 'isActive': false, 'category': 'GENERAL', 'userCount': 0, 'permissions': ['reports.read']},
  ];

  static Map<String, dynamic> _r(String code) => {for (final r in _roles) r['code'] as String: r}[code]! as Map<String, dynamic>;

  static final _users = [
    {'id': 'u1', 'username': 'admin', 'fullNameEn': 'Hossam Adel', 'fullNameAr': 'حسام عادل', 'isActive': true, 'lastLoginAt': '2026-11-27T08:12:00Z', 'extraPermissions': <String>[], 'branches': [], 'roles': [_r('ADMIN')]},
    {'id': 'u2', 'username': 'mona.acc', 'fullNameEn': 'Mona Samir', 'fullNameAr': 'منى سمير', 'isActive': true, 'lastLoginAt': '2026-11-26T14:40:00Z', 'extraPermissions': ['inventory.items.read'], 'branches': [], 'roles': [_r('ACCOUNTANT')]},
    {'id': 'u3', 'username': 'karim.sales', 'fullNameEn': 'Karim Fathy', 'fullNameAr': 'كريم فتحي', 'isActive': true, 'lastLoginAt': '2026-11-27T09:05:00Z', 'extraPermissions': <String>[], 'branches': [], 'roles': [_r('SALES')]},
    {'id': 'u4', 'username': 'omar.store', 'fullNameEn': 'Omar Nabil', 'fullNameAr': 'عمر نبيل', 'isActive': true, 'lastLoginAt': '2026-11-25T11:20:00Z', 'extraPermissions': <String>[], 'branches': [], 'roles': [_r('STOREKEEPER')]},
    {'id': 'u5', 'username': 'laila.old', 'fullNameEn': 'Laila Hassan', 'fullNameAr': 'ليلى حسن', 'isActive': false, 'lastLoginAt': null, 'extraPermissions': <String>[], 'branches': [], 'roles': [_r('SALES')]},
  ];

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/admin/roles') return [for (final r in _roles) Map<String, dynamic>.from(r)];
    if (path == '/admin/users') return [for (final u in _users) Map<String, dynamic>.from(u)];
    if (path == '/company/branches') {
      return [{'id': 'b1', 'code': 'HQ', 'nameEn': 'Headquarters', 'nameAr': 'المقر الرئيسي'}];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async {
    if (path == '/admin/audit-logs') {
      const names = ['admin', 'mona.acc', 'karim.sales', 'omar.store'];
      const acts = ['CREATE', 'UPDATE', 'POST', 'UPDATE', 'CREATE', 'APPROVE', 'UPDATE', 'POST'];
      const ents = ['SalesInvoice', 'User', 'JournalEntry', 'Item', 'Customer', 'StockTransfer', 'Role', 'PurchaseInvoice'];
      return {
        'items': [
          for (var i = 0; i < 8; i++)
            {
              'id': 'a$i',
              'createdAt': '2026-11-27T${(10 - i).toString().padLeft(2, '0')}:${(10 + i * 7).toString().padLeft(2, '0')}:00Z',
              'action': acts[i],
              'entity': ents[i],
              'entityId': '3f9a1c0$i-aaaa-bbbb-cccc-000000000000',
              'username': names[i % 4],
              'ipAddress': '192.168.1.${20 + i}',
              'before': null,
              'after': {'note': 'synthetic'},
            },
        ],
      };
    }
    // The permission catalogue.
    return {
      'items': [
        {'code': 'sales.invoices.read', 'module': 'sales', 'nameEn': 'View sales invoices', 'nameAr': 'عرض فواتير المبيعات'},
        {'code': 'sales.invoices.write', 'module': 'sales', 'nameEn': 'Create and edit sales invoices', 'nameAr': 'إنشاء وتعديل فواتير المبيعات'},
        {'code': 'inventory.items.read', 'module': 'inventory', 'nameEn': 'View items', 'nameAr': 'عرض الأصناف'},
        {'code': 'accounting.journal.read', 'module': 'accounting', 'nameEn': 'View journal entries', 'nameAr': 'عرض القيود'},
        {'code': 'accounting.journal.post', 'module': 'accounting', 'nameEn': 'Post journal entries', 'nameAr': 'ترحيل القيود'},
      ],
      'warnings': [],
    };
  }

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    if (path.endsWith('/effective-permissions')) {
      return {
        'permissions': ['accounting.journal.post', 'accounting.journal.read', 'inventory.items.read', 'sales.invoices.read'],
        'fromRoles': ['accounting.journal.post', 'accounting.journal.read', 'sales.invoices.read'],
        'grantedDirectly': ['inventory.items.read'],
        'denied': <String>[],
        'roles': ['ACCOUNTANT'],
      };
    }
    return {'items': []};
  }
}

Future<void> _fonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    final loader = FontLoader('IBMPlexSansArabic');
    for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$w.ttf').readAsBytesSync())));
    }
    await loader.load();
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();
  });
}

Future<void> _shoot(WidgetTester tester, GlobalKey key, String name) async {
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await screenshotFile('$name.png').writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final arabic in [true, false]) {
    for (final light in [false, true]) {
      final tag = '${arabic ? 'ar' : 'en'}_${light ? 'light' : 'dark'}';

      Future<GlobalKey> open(WidgetTester tester) async {
        await _fonts(tester);
        tester.view.physicalSize = const Size(1500, 900);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final key = GlobalKey();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [apiClientProvider.overrideWithValue(_Api()), currentUserProvider.overrideWithValue(screenshotAdmin)],
            child: RepaintBoundary(
              key: key,
              child: MaterialApp(
                debugShowCheckedModeBanner: false,
                locale: Locale(arabic ? 'ar' : 'en'),
                theme: light ? AppTheme.light() : AppTheme.dark(),
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                home: const Scaffold(body: AdminScreen()),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        return key;
      }

      testWidgets('admin pictures: users ($tag)', (tester) async {
        final key = await open(tester);
        expect(find.text(arabic ? 'منى سمير' : 'Mona Samir'), findsWidgets);
        await _shoot(tester, key, 'admin_users_$tag');
      });

      testWidgets('admin pictures: user permissions dialog ($tag)', (tester) async {
        final key = await open(tester);
        final action = find.byTooltip(arabic ? 'صلاحيات إضافية' : 'Extra permissions').at(1);
        await tester.ensureVisible(action);
        await tester.pumpAndSettle();
        await tester.tap(action);
        await tester.pumpAndSettle();
        expect(find.byType(CheckboxListTile), findsWidgets);
        await _shoot(tester, key, 'admin_user_permissions_$tag');
      });

      testWidgets('admin pictures: roles ($tag)', (tester) async {
        final key = await open(tester);
        await tester.tap(find.byType(Tab).at(1));
        await tester.pumpAndSettle();
        await _shoot(tester, key, 'admin_roles_$tag');
      });

      testWidgets('admin pictures: audit log ($tag)', (tester) async {
        final key = await open(tester);
        await tester.tap(find.byType(Tab).at(2));
        await tester.pumpAndSettle();
        expect(find.textContaining('mona.acc'), findsWidgets);
        await _shoot(tester, key, 'admin_audit_$tag');
      });
    }
  }
}
