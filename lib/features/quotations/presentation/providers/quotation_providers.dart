import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// What the quotation list is narrowing itself to. The same object is used for
/// the request and for the export link, so the file and the screen can never
/// disagree about which rows were being looked at.
class QuotationFilters {
  const QuotationFilters({
    this.status = '',
    this.customerId,
    this.from,
    this.to,
    this.search = '',
  });

  final String status;
  final String? customerId;
  final String? from;
  final String? to;
  final String search;

  bool get isActive =>
      status.isNotEmpty ||
      customerId != null ||
      from != null ||
      to != null ||
      search.trim().isNotEmpty;

  Map<String, dynamic> toQuery() => {
    if (status.isNotEmpty) 'status': status,
    'customerId': ?customerId,
    'from': ?from,
    'to': ?to,
    if (search.trim().isNotEmpty) 'search': search.trim(),
  };

  QuotationFilters copyWith({
    String? status,
    String? customerId,
    String? from,
    String? to,
    String? search,
    bool clearCustomer = false,
    bool clearFrom = false,
    bool clearTo = false,
  }) {
    return QuotationFilters(
      status: status ?? this.status,
      customerId: clearCustomer ? null : (customerId ?? this.customerId),
      from: clearFrom ? null : (from ?? this.from),
      to: clearTo ? null : (to ?? this.to),
      search: search ?? this.search,
    );
  }
}

final quotationFiltersProvider = StateProvider<QuotationFilters>(
  (ref) => const QuotationFilters(),
);

/// The list exactly as the server answered it: every row matching the filters,
/// not only the rows the screen happens to show.
final quotationsProvider = FutureProvider<List<Json>>((ref) async {
  final filters = ref.watch(quotationFiltersProvider);
  return ref
      .read(apiClientProvider)
      .getList('/sales/quotations', query: filters.toQuery());
});

/// One quotation with its tables, lines, events and issued snapshot.
final quotationDetailProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) => ref.read(apiClientProvider).getObject('/sales/quotations/$id'),
);

/// The status labels the list filter offers, in lifecycle order.
const quotationStatuses = <String>[
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
];

/// The company's reusable terms library. Choosing an entry copies its text
/// onto the quotation being edited, so the saved entry and the document stay
/// independent of each other.
final quotationTermsProvider = FutureProvider<List<Json>>((ref) async {
  return ref.read(apiClientProvider).getList('/sales/quotation-terms');
});
