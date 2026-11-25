import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:erp_kayan/shared/widgets/app_error_dialog.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  final posts = <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add(Map<String, dynamic>.from(body! as Map));
    if (posts.length == 1) {
      // The server refuses with a code and a readable sentence; the structured
      // per-line detail is a map, so it never becomes a field error.
      throw const ApiFailure(
        'لم تُحفظ الفاتورة: الكمية أكبر من رصيد المخزون. ITEM-1 (سطر 1): المطلوب 41.0000 والمتاح في فرع الفاتورة 40.0000 piece. خفّض الكمية إلى المتاح أو غيّر المخزن أو احذف الصنف من الفاتورة ثم احفظ من جديد؛ بياناتك كما أدخلتها ولم يُنشأ مستند. / '
        'The invoice was not saved: the quantity is more than the stock on hand. ITEM-1 (line 1): requested 41.0000, available in the invoice branch 40.0000 piece. Lower the quantity to what is available, choose another warehouse, or remove the item, then save again; your entries are kept and no document was created.',
        statusCode: 400,
        code: 'SALES_SAVE_STOCK_SHORT',
      );
    }
    return {'id': 'inv-1'};
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an over-stock refusal shows a readable reason, keeps the typed lines and saves after the quantity is corrected', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeApiClient();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          activeItemsProvider.overrideWith((ref) async => [
            {
              'id': 'item-1',
              'code': 'ITEM-1',
              'nameEn': 'Tracked item',
              'nameAr': 'صنف مخزني',
              'unit': 'piece',
              'isActive': true,
              'isStockTracked': true,
              'taxRate': '14.0000',
              'salePrice': '100.0000',
            },
            {
              'id': 'item-2',
              'code': 'ITEM-2',
              'nameEn': 'Other item',
              'nameAr': 'صنف آخر',
              'unit': 'piece',
              'isActive': true,
              'isStockTracked': true,
              'taxRate': '19.0000',
              'salePrice': '100.0000',
            },
          ]),
          activeCustomersProvider.overrideWith((ref) async => [
            {
              'id': 'customer-1',
              'code': 'CUS-1',
              'nameEn': 'Test customer',
              'nameAr': 'عميل تجريبي',
              'isActive': true,
            },
          ]),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          const InvoiceEditorScreen(kind: InvoiceKind.sales),
                    ),
                  ),
                  child: const Text('Open editor'),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open editor'));
    await tester.pumpAndSettle();

    final dropdowns = find.byType(DropdownButtonFormField<String>);
    await tester.tap(dropdowns.at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CUS-1 — Test customer').last);
    await tester.pumpAndSettle();

    // The item picker carries the blank-state key, because the line has no
    // item until this moment. The document-discount picker comes before it in
    // the tree, so counting dropdowns is not a reliable way to find it.
    await tester.tap(find.byKey(const ValueKey('item-choice-null')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ITEM-1 — Tracked item').last);
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextFormField>(find.byKey(const ValueKey('line-tax-rate-0'))).controller!.text,
      '',
      reason: 'a blank rate stays blank and is saved as zero',
    );
    await tester.enterText(find.byKey(const ValueKey('line-tax-rate-0')), '7');
    await tester.tap(find.byKey(const ValueKey('item-choice-item-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ITEM-2 — Other item').last);
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextFormField>(find.byKey(const ValueKey('line-tax-rate-0'))).controller!.text,
      '7',
      reason: 'changing item must not override a user-entered rate',
    );
    await tester.enterText(find.byKey(const ValueKey('line-tax-rate-0')), '');
    await tester.tap(find.byKey(const ValueKey('item-choice-item-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ITEM-1 — Tracked item').last);
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextFormField>(find.byKey(const ValueKey('line-tax-rate-0'))).controller!.text,
      '',
      reason: 'changing item must not replace an intentionally blank rate',
    );

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '41');
    await tester.enterText(find.byKey(const ValueKey('line-price-0')), '100');
    // An explicitly cleared tax field must be sent as zero, not omitted.
    await tester.enterText(find.byKey(const ValueKey('line-tax-rate-0')), '');
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(api.posts.length, 1);
    // The English interface shows the server's English sentence, with the item,
    // the requested quantity and the available quantity, not a generic notice.
    expect(find.textContaining('The invoice was not saved'), findsOneWidget);
    expect(find.textContaining('requested 41.0000, available in the invoice branch 40.0000'), findsOneWidget);
    expect(find.textContaining('SALES_SAVE_STOCK_SHORT'), findsOneWidget);
    // Nothing the user typed was lost.
    expect(
      tester.widget<TextFormField>(find.byKey(const ValueKey('line-quantity-0'))).controller!.text,
      '41',
    );
    expect(
      tester.widget<TextFormField>(find.byKey(const ValueKey('line-price-0'))).controller!.text,
      '100',
    );
    // Close the message, correct the quantity and save again.
    await tester.tap(find.descendant(of: find.byType(AppErrorDialog), matching: find.byType(FilledButton)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '40');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(api.posts.length, 2);
    final line = (api.posts[1]['lines'] as List).first as Map;
    expect(double.parse(line['quantity'].toString()), 40.0);
  });
}
