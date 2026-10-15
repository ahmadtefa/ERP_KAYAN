import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../dashboard/presentation/providers/dashboard_providers.dart';
/// The one search box: documents, partners and items answered together, so
/// nobody has to open every screen to find an invoice by its number.
Future<void> showGlobalSearchDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (context) => const _GlobalSearchDialog(),
  );
}

class _GlobalSearchDialog extends ConsumerStatefulWidget {
  const _GlobalSearchDialog();

  @override
  ConsumerState<_GlobalSearchDialog> createState() => _GlobalSearchDialogState();
}

class _GlobalSearchDialogState extends ConsumerState<_GlobalSearchDialog> {
  final TextEditingController _controller = TextEditingController();
  Timer? _debounce;
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      setState(() => _query = value);
    });
  }

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final resultsAsync = ref.watch(globalSearchProvider(_query));
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640, maxHeight: 560),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      arabic ? 'بحث شامل' : 'Global search',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  IconButton(
                    tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TextField(
                controller: _controller,
                autofocus: true,
                onChanged: _onChanged,
                onSubmitted: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search_rounded),
                  hintText: arabic
                      ? 'رقم مستند، اسم عميل أو مورد، صنف...'
                      : 'Document number, customer, supplier, item...',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: _query.trim().length < 2
                  ? Center(
                      child: Text(
                        arabic
                            ? 'اكتب حرفين على الأقل للبحث في كل النظام.'
                            : 'Type at least two characters to search everything.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant,
                            ),
                      ),
                    )
                  : resultsAsync.when(
                      loading: () => const Center(
                        child: CircularProgressIndicator(),
                      ),
                      error: (error, _) => Center(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Text(
                            arabic
                                ? 'تعذر إتمام البحث. تحقق من الاتصال ثم أعد المحاولة.'
                                : 'The search could not run. Check the connection and try again.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                      data: (payload) {
                        final rows = listOf(payload['results']);
                        if (rows.isEmpty) {
                          return Center(
                            child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Text(
                                arabic
                                    ? 'لا توجد نتائج مطابقة.'
                                    : 'No matching results.',
                              ),
                            ),
                          );
                        }
                        return ListView.separated(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          itemCount: rows.length,
                          separatorBuilder: (_, _) =>
                              const Divider(height: 1),
                          itemBuilder: (context, index) {
                            final row = rows[index];
                            final route = text(row, 'route');
                            return ListTile(
                              leading: Icon(
                                _iconFor(text(row, 'type')),
                                color: Theme.of(context).colorScheme.primary,
                              ),
                              title: Text(
                                text(row, 'title'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(
                                [
                                  text(row, 'subtitle'),
                                  text(row, 'date'),
                                ].where((part) => part.isNotEmpty).join(' · '),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing: asString(row['amount']) == null
                                  ? null
                                  : Text(
                                      formatAmount(asString(row['amount'])),
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyMedium
                                          ?.copyWith(
                                            fontWeight: FontWeight.w800,
                                          ),
                                    ),
                              onTap: () {
                                Navigator.of(context).pop();
                                if (route.isNotEmpty) context.go(route);
                              },
                            );
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _iconFor(String type) => switch (type) {
      'SALES_INVOICE' => Icons.receipt_long_outlined,
      'PURCHASE_INVOICE' => Icons.shopping_bag_outlined,
      'CASH_VOUCHER' => Icons.payments_outlined,
      'JOURNAL_ENTRY' => Icons.menu_book_outlined,
      'CUSTOMER' => Icons.people_outline,
      'SUPPLIER' => Icons.local_shipping_outlined,
      'ITEM' => Icons.inventory_2_outlined,
      _ => Icons.search_rounded,
    };
