import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// The unread count, as the badge in the top bar reads it.
///
/// Kept as a provider rather than a field on a screen so the badge, the centre
/// and anything else that appears later all read the same number. It is
/// refreshed by the shell after signing in and by the centre after a change,
/// which is enough: an alert is not a chat message, and polling it every
/// second would cost a query per person per second for nothing.
final notificationCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null) return 0;
  // The count is a courtesy; a person without the permission simply has none.
  if (!user.can('notifications.read')) return 0;
  final data = await ref.read(apiClientProvider).get('/notifications/unread-count');
  return (data['unread'] as num?)?.toInt() ?? 0;
});

/// The first few open alerts, for the dashboard.
///
/// Five rows, not a hundred: the dashboard answers "is there anything I must
/// deal with", and the centre is one click away for the rest. The same provider
/// is invalidated by the badge refresh, so the two never disagree.
final notificationFeedProvider = FutureProvider.autoDispose<List<Json>>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null || !user.can('notifications.read')) return const <Json>[];
  final data = await ref.read(apiClientProvider).get(
    '/notifications',
    query: {'status': 'OPEN', 'pageSize': '5'},
  );
  return listOf(data['items']);
});

/// Opens the document an alert is about.
///
/// The server writes the path on the row, so a new kind of alert needs no new
/// screen here. Paths this build knows are routed to the module that owns them;
/// anything else opens the centre, which still shows the alert and its text
/// rather than pretending a click did nothing.
void openNotificationTarget(BuildContext context, Json row) {
  final path = text(row, 'actionPath');
  const routes = <String, String>{
    '/inventory/batches': AppRoutes.batches,
    '/inventory/items': AppRoutes.items,
    '/inventory/stock-takes': AppRoutes.stockTakes,
    '/inventory/write-offs': AppRoutes.writeOffs,
    '/inventory/stock': AppRoutes.stock,
    '/inventory/documents': AppRoutes.stockDocuments,
    '/inventory/stock-transfers': AppRoutes.stockTransfers,
    '/sales/returns': AppRoutes.salesReturns,
    '/sales/invoices': AppRoutes.salesInvoices,
    '/sales/orders': AppRoutes.salesOrders,
    '/purchases/returns': AppRoutes.purchaseReturns,
    '/purchases/invoices': AppRoutes.purchaseInvoices,
    '/purchases/orders': AppRoutes.purchaseOrders,
    '/accounting/journal-entries': AppRoutes.journalEntries,
    '/cash': AppRoutes.cash,
    '/administration': AppRoutes.administration,
  };
  final uri = Uri.tryParse(path);
  if (uri != null) {
    for (final entry in routes.entries) {
      if (uri.path == entry.key || uri.path.startsWith('${entry.key}/')) {
        // Keep a linked document identifier/filter when the owning screen
        // supports one; never discard the action target's query parameters.
        final query = uri.hasQuery ? '?${uri.query}' : '';
        context.go('${entry.value}$query');
        return;
      }
    }
  }
  context.go(AppRoutes.notifications);
}

/// The program's notification centre.
///
/// Not an inventory screen with a stock icon: everything the program wants a
/// person to know arrives here, whatever module raised it. Stock is only the
/// first module with something worth saying, and the row itself says which
/// document it belongs to and which permission is needed to see it - so a
/// clerk is told a lot expired without being told what it cost.
class NotificationCenterScreen extends ConsumerStatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  ConsumerState<NotificationCenterScreen> createState() =>
      _NotificationCenterScreenState();
}

/// The kinds the filter offers, in the order a person thinks about them. The
/// labels live here rather than on the server because the screen must say
/// something useful even if a kind is added before the text is translated.
const notificationTypeFilters = <({String type, String ar, String en})>[
  (type: '', ar: 'كل الأنواع', en: 'All types'),
  (type: 'STOCK_BELOW_MINIMUM', ar: 'أقل من الحد الأدنى', en: 'Below minimum'),
  (type: 'STOCK_OUT_OF_STOCK', ar: 'نفد من المخزن', en: 'Out of stock'),
  (type: 'STOCK_EXPIRY_SOON', ar: 'قريب الانتهاء', en: 'Expiring soon'),
  (type: 'STOCK_EXPIRED', ar: 'منتهي الصلاحية', en: 'Expired'),
  (type: 'STOCK_VOUCHER_PENDING_APPROVAL', ar: 'مستندات تنتظر الاعتماد', en: 'Awaiting approval'),
  (type: 'STOCK_TRANSFER_REVIEW_REQUIRED', ar: 'تحويلات تنتظر المراجعة', en: 'Transfers awaiting review'),
  (type: 'STOCK_TRANSFER_APPROVAL_REQUIRED', ar: 'تحويلات تنتظر الاعتماد', en: 'Transfers awaiting approval'),
  (type: 'STOCK_TRANSFER_DISPATCH_REQUIRED', ar: 'تحويلات تنتظر التسليم', en: 'Transfers awaiting dispatch'),
  (type: 'STOCK_TRANSFER_RECEIPT_REQUIRED', ar: 'بضاعة بالطريق تنتظر الاستلام', en: 'Goods awaiting receipt'),
  (type: 'STOCK_TRANSFER_RECEIVED', ar: 'استلامات التحويلات', en: 'Transfer receipts'),
  (type: 'STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED', ar: 'فروق تنتظر الاعتماد', en: 'Differences awaiting approval'),
  (type: 'STOCK_TRANSFER_CLOSE_REQUIRED', ar: 'تحويلات مكتملة تنتظر الإغلاق', en: 'Transfers awaiting closure'),
  (type: 'JOURNAL_PENDING_APPROVAL', ar: 'قيود تنتظر الاعتماد', en: 'Journals to approve'),
  (type: 'INVOICE_OVERDUE', ar: 'فواتير عملاء متأخرة', en: 'Overdue invoices'),
  (type: 'PAYABLE_DUE', ar: 'مستحقات موردين قريبة', en: 'Supplier bills due'),
  (type: 'PAYABLE_OVERDUE', ar: 'مستحقات موردين متأخرة', en: 'Supplier bills overdue'),
  (type: 'STOCK_ABNORMAL', ar: 'أرصدة غير منطقية', en: 'Impossible balances'),
  (type: 'ADMIN_ALERT', ar: 'تنبيهات إدارية', en: 'Administrative'),
];

class _NotificationCenterScreenState
    extends ConsumerState<NotificationCenterScreen> {
  Future<List<Json>>? _future;
  String _status = 'OPEN';
  String _severity = '';
  String _type = '';
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Json>> _load() async {
    final user = ref.read(currentUserProvider);
    if (user == null || !user.can('notifications.read')) return const <Json>[];
    const pageSize = 200;
    final items = <Json>[];
    var page = 1;
    var total = 0;
    try {
      do {
        // Dio serializes query values to strings exactly like the other
        // Flutter requests; the Nest DTO transforms `page` and `pageSize`
        // before validating them. Continue until every permitted row is read.
        final data = await ref.read(apiClientProvider).get(
          '/notifications',
          query: {
            'status': _status,
            if (_severity.isNotEmpty) 'severity': _severity,
            if (_type.isNotEmpty) 'type': _type,
            'page': '$page',
            'pageSize': '$pageSize',
          },
        );
        final rows = listOf(data['items']);
        items.addAll(rows);
        total = (data['total'] as num?)?.toInt() ?? items.length;
        if (rows.isEmpty) break;
        page += 1;
      } while (items.length < total);
      return items;
    } catch (error, stackTrace) {
      // Keep API details in Flutter's diagnostic log, never in the visible
      // screen. The user gets one stable Arabic-friendly retry message below.
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'notifications',
        context: ErrorDescription('Loading notifications failed'),
      ));
      rethrow;
    }
  }

  void _refresh() {
    setState(() => _future = _load());
    ref.invalidate(notificationCountProvider);
  }

  Future<void> _markRead(Json row) async {
    try {
      await ref.read(apiClientProvider).post('/notifications/${row['id']}/read');
      _refresh();
    } catch (error) {
      // A failed action is an error, not a status line. "$error" printed the
      // raw object in a SnackBar that dismissed itself; the dialog queue says it
      // once and waits to be acknowledged. The sentence stays the one ApiClient
      // extracted from the response, because a refusal written for the operator
      // is more useful than a generic replacement.
      if (mounted) {
        await showAppError(context, error);
      }
    }
  }

  Future<void> _markUnread(Json row) async {
    try {
      await ref.read(apiClientProvider).post('/notifications/${row['id']}/unread');
      _refresh();
    } catch (error) {
      if (mounted) {
        await showAppError(context, error);
      }
    }
  }

  Future<void> _archive(Json row) async {
    try {
      await ref.read(apiClientProvider).post('/notifications/${row['id']}/archive');
      _refresh();
    } catch (error) {
      // A failed action is an error, not a status line. "$error" printed the
      // raw object in a SnackBar that dismissed itself; the dialog queue says it
      // once and waits to be acknowledged. The sentence stays the one ApiClient
      // extracted from the response, because a refusal written for the operator
      // is more useful than a generic replacement.
      if (mounted) {
        await showAppError(context, error);
      }
    }
  }

  Future<void> _markAllRead() async {
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post('/notifications/read-all');
      _refresh();
    } catch (error) {
      // A failed action is an error, not a status line. "$error" printed the
      // raw object in a SnackBar that dismissed itself; the dialog queue says it
      // once and waits to be acknowledged. The sentence stays the one ApiClient
      // extracted from the response, because a refusal written for the operator
      // is more useful than a generic replacement.
      //
      // The busy flag is cleared first: the dialog is awaited, and a spinner
      // still turning behind the modal barrier means the screen does not settle.
      if (mounted) {
        setState(() => _busy = false);
        await showAppError(context, error);
      }
    } finally {
      if (mounted && _busy) setState(() => _busy = false);
    }
  }

  /// Every deletion here is personal and non-destructive: the alert row, the
  /// document behind it and the audit trail are never touched. The confirm
  /// dialog says so in the person's own language before anything happens.
  Future<bool?> _confirm(String title, String message, {bool danger = false}) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(_t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            style: danger
                ? FilledButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.error,
                  )
                : null,
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(_t('تأكيد', 'Confirm')),
          ),
        ],
      ),
    );
  }

  /// Runs one deletion and reports the real outcome. A failed call shows the
  /// server's own reason and leaves the list untouched — never a success that
  /// did not happen.
  Future<void> _runDelete(Future<Map<String, dynamic>> Function() op) async {
    setState(() => _busy = true);
    try {
      final result = await op();
      final count = (result['deleted'] as num?)?.toInt();
      if (mounted) setState(() => _busy = false);
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(count == null
                ? _t('تم الحذف', 'Deleted')
                : _t('تم الحذف ($count)', 'Deleted ($count)')),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() => _busy = false);
        await showAppError(context, error);
      }
    }
  }

  Future<void> _confirmDeleteOne(Json row) async {
    final ok = await _confirm(
      _t('حذف التنبيه؟', 'Delete this alert?'),
      _t(
        'سيختفي التنبيه من قائمتك أنت فقط. المستند أو الفاتورة المرتبطة به لن تتأثر، ويظل سجل التدقيق كما هو.',
        'The alert disappears from your list only. The invoice or document behind it is untouched, and the audit trail stays.',
      ),
    );
    if (ok != true) return;
    await _runDelete(
      () => ref.read(apiClientProvider).delete('/notifications/${row['id']}'),
    );
  }

  Future<void> _confirmDeleteRead() async {
    final ok = await _confirm(
      _t('حذف التنبيهات المقروءة؟', 'Delete read alerts?'),
      _t(
        'تُحذف التنبيهات التي قرأتها من قائمتك أنت فقط. التنبيهات غير المقروءة تبقى كما هي.',
        'The alerts you have read are removed from your list only. Unread alerts stay.',
      ),
    );
    if (ok != true) return;
    await _runDelete(() => ref.read(apiClientProvider).delete('/notifications/read'));
  }

  Future<void> _confirmDeleteAll() async {
    final ok = await _confirm(
      _t('حذف جميع التنبيهات؟', 'Delete all alerts?'),
      _t(
        'تُحذف جميع تنبيهاتك — بما فيها غير المقروءة — من قائمتك أنت فقط. لن تتأثر تنبيهات زملائك أو المستندات المرتبطة.',
        'All of your alerts — unread included — are removed from your list only. Colleagues and the linked documents are unaffected.',
      ),
      danger: true,
    );
    if (ok != true) return;
    await _runDelete(() => ref.read(apiClientProvider).delete('/notifications/all'));
  }

  Future<void> _confirmDeleteOld() async {
    var days = 30;
    var includeUnread = false;
    int? preview;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setStateDialog) => AlertDialog(
          title: Text(_t('حذف التنبيهات القديمة', 'Delete old alerts')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_t('حذف التنبيهات الأقدم من:', 'Delete alerts older than:')),
              const SizedBox(height: 8),
              DropdownButton<int>(
                value: days,
                isExpanded: true,
                items: [
                  DropdownMenuItem(value: 7, child: Text(_t('7 أيام', '7 days'))),
                  DropdownMenuItem(value: 30, child: Text(_t('30 يومًا', '30 days'))),
                  DropdownMenuItem(value: 90, child: Text(_t('90 يومًا', '90 days'))),
                ],
                onChanged: (value) => setStateDialog(() {
                  days = value ?? 30;
                  preview = null;
                }),
              ),
              CheckboxListTile(
                value: includeUnread,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: Text(_t('تضمين غير المقروءة', 'Include unread')),
                subtitle: Text(
                  _t(
                    'افتراضيًا تبقى غير المقروءة محمية.',
                    'Unread alerts are protected unless you ask for them.',
                  ),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                onChanged: (value) => setStateDialog(() {
                  includeUnread = value ?? false;
                  preview = null;
                }),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                icon: const Icon(Icons.calculate_outlined, size: 18),
                label: Text(preview == null
                    ? _t('عرض العدد', 'Show count')
                    : _t('سيتم حذف: $preview', 'Will delete: $preview')),
                onPressed: () async {
                  final data = await ref.read(apiClientProvider).get(
                        '/notifications/cleanup-preview',
                        query: {
                          'days': '$days',
                          'includeUnread': '$includeUnread',
                        },
                      );
                  setStateDialog(() {
                    preview = (data['count'] as num?)?.toInt() ?? 0;
                  });
                },
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(_t('إلغاء', 'Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(_t('حذف', 'Delete')),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    await _runDelete(
      () => ref.read(apiClientProvider).delete(
            '/notifications/older?days=$days&includeUnread=$includeUnread',
          ),
    );
  }

  /// Opens the thing the alert is about.
  ///
  /// The server writes the path on the row, so the centre never has to know
  /// what a lot or an invoice is. A path this build does not have is reported
  /// rather than guessed at.
  void _open(Json row) {
    if (text(row, 'actionPath').isEmpty) return;
    openNotificationTarget(context, row);
  }

  Color _tone(ThemeData theme, String severity) {
    switch (severity) {
      case 'CRITICAL':
        return theme.colorScheme.error;
      case 'WARNING':
        return const Color(0xFFE8710A);
      default:
        return theme.colorScheme.primary;
    }
  }

  IconData _icon(String type) {
    switch (type) {
      case 'STOCK_EXPIRED':
      case 'STOCK_EXPIRY_SOON':
        return Icons.event_busy_outlined;
      case 'STOCK_BELOW_MINIMUM':
        return Icons.trending_down_rounded;
      case 'STOCK_OUT_OF_STOCK':
        return Icons.remove_shopping_cart_outlined;
      case 'STOCK_ABOVE_MAXIMUM':
        return Icons.trending_up_rounded;
      case 'STOCK_EXPIRED_WRITE_OFF_PENDING':
        return Icons.delete_sweep_outlined;
      case 'STOCK_VOUCHER_PENDING_APPROVAL':
        return Icons.fact_check_outlined;
      case 'STOCK_TRANSFER_REVIEW_REQUIRED':
      case 'STOCK_TRANSFER_APPROVAL_REQUIRED':
      case 'STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED':
        return Icons.rule_folder_outlined;
      case 'STOCK_TRANSFER_DISPATCH_REQUIRED':
        return Icons.local_shipping_outlined;
      case 'STOCK_TRANSFER_RECEIPT_REQUIRED':
      case 'STOCK_TRANSFER_RECEIVED':
        return Icons.inventory_2_outlined;
      case 'STOCK_TRANSFER_CLOSE_REQUIRED':
        return Icons.task_alt_outlined;
      case 'JOURNAL_PENDING_APPROVAL':
        return Icons.playlist_add_check_rounded;
      case 'INVOICE_OVERDUE':
        return Icons.request_quote_outlined;
      case 'PAYABLE_DUE':
        return Icons.event_available_outlined;
      case 'PAYABLE_OVERDUE':
        return Icons.money_off_csred_outlined;
      case 'STOCK_ABNORMAL':
        return Icons.warning_amber_rounded;
      case 'ADMIN_ALERT':
        return Icons.manage_accounts_outlined;
      default:
        return Icons.notifications_none_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    if (user == null || !user.can('notifications.read')) {
      return ModuleScaffold(
        title: _t('التنبيهات', 'Notifications'),
        body: Center(
          child: Text(
            _t('ليس لديك صلاحية لعرض التنبيهات.', 'You do not have permission to view notifications.'),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    final theme = Theme.of(context);
    return ModuleScaffold(
      title: _t('التنبيهات', 'Notifications'),
      subtitle: _t(
        'كل ما يريد البرنامج أن تعرفه، في مكان واحد: صلاحية البضاعة، الحد الأدنى للمخزون، وما يحتاج قرارًا.',
        'Everything the program wants you to know, in one place: expiry, stock below its minimum, '
            'and what needs a decision.',
      ),
      actions: [
        TextButton.icon(
          onPressed: _busy ? null : _markAllRead,
          icon: const Icon(Icons.done_all_rounded, size: 18),
          label: Text(_t('تحديد الكل كمقروء', 'Mark all read')),
        ),
        PopupMenuButton<String>(
          tooltip: _t('إدارة التنبيهات', 'Manage alerts'),
          enabled: !_busy,
          onSelected: (value) {
            switch (value) {
              case 'delete-read':
                _confirmDeleteRead();
              case 'delete-old':
                _confirmDeleteOld();
              case 'delete-all':
                _confirmDeleteAll();
            }
          },
          itemBuilder: (context) => [
            PopupMenuItem(
              value: 'delete-read',
              child: Row(children: [
                const Icon(Icons.mark_email_read_outlined, size: 18),
                const SizedBox(width: 8),
                Text(_t('حذف المقروءة', 'Delete read')),
              ]),
            ),
            PopupMenuItem(
              value: 'delete-old',
              child: Row(children: [
                const Icon(Icons.event_busy_outlined, size: 18),
                const SizedBox(width: 8),
                Text(_t('حذف التنبيهات القديمة', 'Delete old')),
              ]),
            ),
            PopupMenuItem(
              value: 'delete-all',
              child: Row(children: [
                Icon(Icons.delete_sweep_outlined, size: 18, color: theme.colorScheme.error),
                const SizedBox(width: 8),
                Text(_t('حذف جميع التنبيهات', 'Delete all')),
              ]),
            ),
          ],
        ),
      ],
      body: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                DropdownButton<String>(
                  value: _status,
                  items: [
                    DropdownMenuItem(value: 'OPEN', child: Text(_t('غير المقروءة', 'Unread'))),
                    DropdownMenuItem(
                      value: 'READ',
                      child: Text(_t('المقروءة', 'Read')),
                    ),
                    DropdownMenuItem(
                      value: 'ARCHIVED',
                      child: Text(_t('المؤرشفة', 'Archived')),
                    ),
                    DropdownMenuItem(value: 'ALL', child: Text(_t('الكل', 'All'))),
                  ],
                  onChanged: (value) => setState(() {
                    _status = value ?? 'OPEN';
                    _future = _load();
                  }),
                ),
                DropdownButton<String>(
                  value: _type,
                  items: [
                    for (final filter in notificationTypeFilters)
                      DropdownMenuItem(
                        value: filter.type,
                        child: Text(_arabic ? filter.ar : filter.en),
                      ),
                  ],
                  onChanged: (value) => setState(() {
                    _type = value ?? '';
                    _future = _load();
                  }),
                ),
                DropdownButton<String>(
                  value: _severity,
                  items: [
                    DropdownMenuItem(value: '', child: Text(_t('كل الأولويات', 'All priorities'))),
                    DropdownMenuItem(
                      value: 'CRITICAL',
                      child: Text(_t('حرجة', 'Critical')),
                    ),
                    DropdownMenuItem(
                      value: 'WARNING',
                      child: Text(_t('تحذير', 'Warning')),
                    ),
                    DropdownMenuItem(value: 'INFO', child: Text(_t('معلومات', 'Info'))),
                  ],
                  onChanged: (value) => setState(() {
                    _severity = value ?? '';
                    _future = _load();
                  }),
                ),
                IconButton(
                  tooltip: _t('تحديث', 'Refresh'),
                  onPressed: _refresh,
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Expanded(
              child: FutureBuilder<List<Json>>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _t(
                              'تعذر تحميل التنبيهات. تحقق من الاتصال ثم أعد المحاولة.',
                              'Notifications could not be loaded. Check the connection and retry.',
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          OutlinedButton.icon(
                            onPressed: _refresh,
                            icon: const Icon(Icons.refresh_rounded),
                            label: Text(_t('إعادة المحاولة', 'Retry')),
                          ),
                        ],
                      ),
                    );
                  }
                  final rows = snapshot.data ?? const <Json>[];
                  if (rows.isEmpty) {
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.notifications_off_outlined,
                            size: 40,
                            color: theme.colorScheme.outline,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            _t('لا توجد تنبيهات', 'There is nothing to tell you right now'),
                            style: theme.textTheme.bodyLarge,
                          ),
                        ],
                      ),
                    );
                  }
                  return ListView.separated(
                    itemCount: rows.length,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: AppSpacing.xs),
                    itemBuilder: (context, index) {
                      final row = rows[index];
                      final severity = text(row, 'severity');
                      final tone = _tone(theme, severity);
                      final isRead = row['isRead'] == true;
                      return Card(
                        elevation: 0,
                        color: isRead
                            ? theme.colorScheme.surface
                            : theme.colorScheme.surfaceContainerHighest
                                .withValues(alpha: 0.45),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadii.md),
                          side: BorderSide(
                            color: isRead
                                ? theme.colorScheme.outlineVariant
                                : tone.withValues(alpha: 0.45),
                          ),
                        ),
                        child: ListTile(
                          onTap: () async {
                            // Read first, then open. Marking the row after
                            // navigating raced the screen's disposal: the call
                            // died silently and the badge kept its stale
                            // number — the bug the bell was blamed for.
                            if (!isRead) await _markRead(row);
                            if (mounted) _open(row);
                          },
                          leading: CircleAvatar(
                            radius: 16,
                            backgroundColor: tone.withValues(alpha: 0.14),
                            child: Icon(_icon(text(row, 'type')), size: 18, color: tone),
                          ),
                          title: Text(
                            _arabic
                                ? text(row, 'titleAr')
                                : text(row, 'titleEn'),
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: isRead ? FontWeight.w500 : FontWeight.w700,
                            ),
                          ),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              _arabic
                                  ? text(row, 'bodyAr')
                                  : text(row, 'bodyEn'),
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (!isRead)
                                IconButton(
                                  tooltip: _t('تم', 'Mark read'),
                                  onPressed: () => _markRead(row),
                                  icon: const Icon(Icons.check_rounded, size: 18),
                                )
                              else
                                IconButton(
                                  tooltip: _t('غير مقروء', 'Mark unread'),
                                  onPressed: () => _markUnread(row),
                                  icon: const Icon(Icons.mark_email_unread_outlined, size: 18),
                                ),
                              IconButton(
                                tooltip: _t('أرشفة', 'Archive'),
                                onPressed: () => _archive(row),
                                icon: const Icon(Icons.archive_outlined, size: 18),
                              ),
                              IconButton(
                                tooltip: _t('حذف', 'Delete'),
                                onPressed: () => _confirmDeleteOne(row),
                                icon: const Icon(Icons.delete_outline, size: 18),
                              ),
                            ],
                          ),
                        ),
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

/// The bell in the top bar, with the number that has not been read.
///
/// A badge is not decoration: it is the only way a person learns that a lot
/// expires in three days without opening a screen to ask. It shows nothing at
/// all when there is nothing to say, rather than a zero.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key, this.foreground});

  final Color? foreground;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(notificationCountProvider).asData?.value ?? 0;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return IconButton(
      tooltip: arabic ? 'التنبيهات' : 'Notifications',
      onPressed: () => context.go(AppRoutes.notifications),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '٩٩+' : '$count'),
        child: Icon(
          Icons.notifications_none_rounded,
          size: 19,
          color: foreground,
        ),
      ),
    );
  }
}
