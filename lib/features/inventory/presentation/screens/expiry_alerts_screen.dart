import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Which slice of the expiry feed the screen is showing.
///
/// The server groups every live lot into exactly one of these, so the tabs are
/// a filter on a fact rather than a separate question: `EXPIRED` is the lot the
/// storekeeper must write off, `EXPIRING_SOON` is the one to sell first, and
/// `VALID` is everything with time left.
enum ExpiryGroup { expired, expiringSoon, valid }

extension on ExpiryGroup {
  /// The value the server puts on each row.
  String get wire => switch (this) {
    ExpiryGroup.expired => 'EXPIRED',
    ExpiryGroup.expiringSoon => 'EXPIRING_SOON',
    ExpiryGroup.valid => 'VALID',
  };
}

/// One page of the expiry feed, as the server answered it.
class ExpiryAlerts {
  const ExpiryAlerts({
    required this.asOf,
    required this.counts,
    required this.horizonDays,
    required this.items,
  });

  /// The day the server measured "days left" from. Shown, not recomputed: the
  /// device clock and the server's can disagree, and the alert is the server's.
  final String asOf;
  final ({int expired, int expiringSoon, int valid, int total}) counts;

  /// The "expiring soon" horizon the server used, so the tab can say it.
  final int horizonDays;
  final List<Json> items;

  int countOf(ExpiryGroup group) => switch (group) {
    ExpiryGroup.expired => counts.expired,
    ExpiryGroup.expiringSoon => counts.expiringSoon,
    ExpiryGroup.valid => counts.valid,
  };

  List<Json> rowsOf(ExpiryGroup group) =>
      items.where((row) => text(row, 'group') == group.wire).toList(growable: false);
}

/// The expiry-alert feed.
///
/// Reads `/inventory/batches/alerts`, which groups the live lots and attaches
/// the alert standing against each one. Asking for a scan is a separate grant:
/// the button is offered only to a user holding `notifications.manage`, and the
/// server refuses the request even if this screen were bypassed.
final expiryAlertsProvider = FutureProvider.autoDispose<ExpiryAlerts>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null || !user.can('inventory.batches.read')) {
    // Not an error: a person the alerts are not written for simply has none.
    return const ExpiryAlerts(
      asOf: '',
      counts: (expired: 0, expiringSoon: 0, valid: 0, total: 0),
      horizonDays: 90,
      items: [],
    );
  }
  return _fetch(ref.read(apiClientProvider));
});

/// Reads the feed, optionally asking the server to scan first.
///
/// Takes the api client rather than a `Ref` or a `WidgetRef`: the provider has
/// the first and the widget has the second, they are different types, and the
/// parsing below does not care which one reached it.
Future<ExpiryAlerts> _fetch(ApiClient client, {bool scan = false}) async {
  final data = await client.get(
    '/inventory/batches/alerts',
    query: {if (scan) 'scan': 'true'},
  );
  final counts = data['counts'] is Map ? Map<String, dynamic>.from(data['counts'] as Map) : const <String, dynamic>{};
  return ExpiryAlerts(
    asOf: text(data, 'asOf'),
    counts: (
      expired: (counts['expired'] as num?)?.toInt() ?? 0,
      expiringSoon: (counts['expiringSoon'] as num?)?.toInt() ?? 0,
      valid: (counts['valid'] as num?)?.toInt() ?? 0,
      total: (counts['total'] as num?)?.toInt() ?? 0,
    ),
    horizonDays: (data['horizonDays'] as num?)?.toInt() ?? 90,
    items: listOf(data['items']),
  );
}

/// Inventory expiry alerts: what has gone off, what is about to, and what is
/// still good - with the shelf, the quantity and the alert standing against it.
///
/// This is a working screen, not a second notification centre: every row is a
/// lot the storekeeper can act on, and the two buttons on it go to the places
/// the action happens. The centre remains the inbox; this is the shelf list.
class ExpiryAlertsScreen extends ConsumerStatefulWidget {
  const ExpiryAlertsScreen({super.key});

  @override
  ConsumerState<ExpiryAlertsScreen> createState() => _ExpiryAlertsScreenState();
}

class _ExpiryAlertsScreenState extends ConsumerState<ExpiryAlertsScreen> {
  ExpiryGroup _group = ExpiryGroup.expiringSoon;
  bool _scanning = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  /// Asks the server to look again, then reloads what it found.
  ///
  /// The scan is the point of the button: a refresh that re-read the same rows
  /// would show an unchanged list after a lot had been written off elsewhere.
  /// A refusal is shown as the server worded it rather than swallowed.
  Future<void> _scan() async {
    final user = ref.read(currentUserProvider);
    if (user == null || !user.can('notifications.manage')) return;
    setState(() => _scanning = true);
    try {
      await _fetch(ref.read(apiClientProvider), scan: true);
      ref.invalidate(expiryAlertsProvider);
      await ref.read(expiryAlertsProvider.future);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_t('تم فحص الصلاحية.', 'Expiry scan finished.'))),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  void _reload() => ref.invalidate(expiryAlertsProvider);

  String _itemName(Json row) =>
      _arabic ? text(row, 'itemNameAr') : text(row, 'itemNameEn');

  String _warehouse(Json row) =>
      _arabic ? text(row, 'warehouseNameAr') : text(row, 'warehouseNameEn');

  String _shelf(Json row) {
    final location = row['storageLocation'];
    if (location is! Map) return '—';
    final shelf = Map<String, dynamic>.from(location);
    return _arabic
        ? text(shelf, 'nameAr', fallback: text(shelf, 'code'))
        : text(shelf, 'nameEn', fallback: text(shelf, 'code'));
  }

  /// A `@db.Date` arrives as a full timestamp; only the day means anything.
  String _dateCell(Object? value) {
    final raw = asString(value);
    if (raw == null || raw.isEmpty) return '—';
    return raw.split('T').first;
  }

  String _days(Json row) {
    final days = asNum(row['daysToExpiry']);
    if (days == null) return '—';
    return days.toString();
  }

  /// What the notification centre holds for this lot, in words.
  ///
  /// Read from the row the server attached rather than worked out from the
  /// dates: a lot can be inside the warning window and still have no alert, if
  /// the scanner has not run or the kind is switched off. Saying "no alert"
  /// there is the truth; guessing "warning" would quietly disagree with the
  /// centre.
  String _alertState(Json row) {
    final alert = row['alert'];
    if (alert is! Map) {
      return _t('لا يوجد تنبيه', 'No alert');
    }
    final status = text(Map<String, dynamic>.from(alert), 'status');
    return switch (status) {
      'OPEN' => _t('مفتوح', 'Open'),
      'READ' => _t('مقروء', 'Read'),
      'CLOSED' => _t('مغلق', 'Closed'),
      'ARCHIVED' => _t('مؤرشف', 'Archived'),
      _ => status,
    };
  }

  AppTone _alertTone(Json row) {
    final alert = row['alert'];
    if (alert is! Map) return AppTone.neutral;
    final status = text(Map<String, dynamic>.from(alert), 'status');
    return switch (status) {
      'OPEN' => AppTone.danger,
      'READ' => AppTone.warning,
      'CLOSED' || 'ARCHIVED' => AppTone.success,
      _ => AppTone.neutral,
    };
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(expiryAlertsProvider);
    final user = ref.watch(currentUserProvider);
    final mayScan = user?.can('notifications.manage') ?? false;
    final mayWriteOff = user?.can('inventory.batches.writeoff') ?? false;

    return ModuleScaffold(
      title: _t('تنبيهات صلاحية المخزون', 'Inventory expiry alerts'),
      eyebrow: _t('المخزون', 'Inventory'),
      subtitle: _t(
        'ما انتهى، وما ينتهي قريبًا، وما زال صالحًا - بالكمية والمخزن والموقع. التنبيهات يرفعها الفحص التلقائي.',
        'What has expired, what expires soon and what is still good - with quantity, '
            'warehouse and shelf. The alerts are raised by the automatic scan.',
      ),
      trailing: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          IconButton(
            tooltip: _t('تحديث', 'Refresh'),
            onPressed: _reload,
            icon: const Icon(Icons.refresh),
          ),
          if (mayScan)
            FilledButton.icon(
              onPressed: _scanning ? null : _scan,
              icon: _scanning
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.radar_outlined),
              label: Text(_t('فحص الآن', 'Scan now')),
            ),
        ],
      ),
      actions: [
        TextButton.icon(
          onPressed: () => context.go(AppRoutes.notifications),
          icon: const Icon(Icons.notifications_none_rounded, size: 18),
          label: Text(_t('مركز التنبيهات', 'Notification centre')),
        ),
      ],
      body: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: AsyncStateView<ExpiryAlerts>(
          value: async,
          onRetry: _reload,
          loadingMessage: _t('جارٍ تحميل تنبيهات الصلاحية…', 'Loading expiry alerts…'),
          isEmpty: (data) => data.items.isEmpty,
          emptyMessage: _t(
            'لا توجد دفعات قابلة للتنبيه: كل المخزون إما بلا تاريخ انتهاء أو تم صرفه.',
            'Nothing to alert on: every lot either has no expiry date or has been issued.',
          ),
          data: (data) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _tabs(data),
              const SizedBox(height: AppSpacing.md),
              Expanded(child: _table(data, mayWriteOff: mayWriteOff)),
              const SizedBox(height: AppSpacing.sm),
              Text(
                _t(
                  'محسوبة حتى ${data.asOf} • نافذة "قريبًا" ${data.horizonDays} يومًا',
                  'Measured as of ${data.asOf} • "soon" window is ${data.horizonDays} days',
                ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tabs(ExpiryAlerts data) {
    final theme = Theme.of(context);
    Widget tab(ExpiryGroup group, String label, AppTone tone) {
      final selected = _group == group;
      final count = data.countOf(group);
      return Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: ChoiceChip(
          selected: selected,
          onSelected: (_) => setState(() => _group = group),
          avatar: CircleAvatar(
            radius: 9,
            backgroundColor: tone.foreground.withValues(alpha: 0.15),
            child: Text(
              '$count',
              style: theme.textTheme.labelSmall?.copyWith(
                color: tone.foreground,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          label: Text(label),
        ),
      );
    }

    return Wrap(
      children: [
        tab(
          ExpiryGroup.expired,
          _t('المنتهي', 'Expired'),
          AppTone.danger,
        ),
        tab(
          ExpiryGroup.expiringSoon,
          _t('سينتهي قريبًا', 'Expiring soon'),
          AppTone.warning,
        ),
        tab(ExpiryGroup.valid, _t('الصالح', 'Valid'), AppTone.success),
      ],
    );
  }

  Widget _table(ExpiryAlerts data, {required bool mayWriteOff}) {
    final rows = data.rowsOf(_group);
    if (rows.isEmpty) {
      return EmptyView(
        message: switch (_group) {
          ExpiryGroup.expired => _t('لا توجد دفعات منتهية.', 'No expired lots.'),
          ExpiryGroup.expiringSoon => _t(
            'لا توجد دفعات قريبة الانتهاء.',
            'No lots expiring soon.',
          ),
          ExpiryGroup.valid => _t('لا توجد دفعات صالحة بكمية متبقية.', 'No valid lots in stock.'),
        },
        icon: Icons.event_available_outlined,
      );
    }
    return RecordsTable(
      rows: rows,
      onTap: (row) => context.go(AppRoutes.batches),
      actions: (row) {
        // Writing off an expired lot is the action this screen exists to make
        // reachable, and it is offered only to a user the server would let do
        // it. The work itself stays on the batches screen: one place posts a
        // write-off, and this is not it.
        final group = text(row, 'group');
        if (group != 'EXPIRED' || !mayWriteOff) return const <Widget>[];
        return [
          TextButton(
            onPressed: () => context.go(AppRoutes.batches),
            child: Text(_t('إعدام', 'Write off')),
          ),
        ];
      },
      columns: [
        ColumnSpec(_t('الصنف', 'Item'), value: _itemName, flex: 2),
        ColumnSpec(_t('رقم الدفعة', 'Batch'), value: (row) => text(row, 'batchNumber')),
        ColumnSpec(
          _t('الإنتاج', 'Production'),
          value: (row) => _dateCell(row['productionDate']),
        ),
        ColumnSpec(
          _t('الانتهاء', 'Expiry'),
          value: (row) => _dateCell(row['expiryDate']),
        ),
        ColumnSpec(
          _t('المتبقي', 'Remaining'),
          numeric: true,
          value: (row) => text(row, 'quantity'),
        ),
        ColumnSpec(_t('المخزن', 'Warehouse'), value: _warehouse),
        ColumnSpec(_t('الموقع', 'Shelf'), value: _shelf),
        ColumnSpec(
          _t('الأيام', 'Days'),
          numeric: true,
          value: _days,
          tone: (row) {
            final days = asNum(row['daysToExpiry']);
            if (days == null) return AppTone.neutral;
            if (days < 0) return AppTone.danger;
            if (days <= 30) return AppTone.warning;
            return AppTone.success;
          },
        ),
        ColumnSpec(
          _t('حالة التنبيه', 'Alert'),
          value: _alertState,
          tone: _alertTone,
        ),
      ],
    );
  }
}
