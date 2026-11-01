import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
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

class _NotificationCenterScreenState
    extends ConsumerState<NotificationCenterScreen> {
  Future<List<Json>>? _future;
  String _status = 'OPEN';
  String _severity = '';
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Json>> _load() async {
    final data = await ref.read(apiClientProvider).get(
      '/notifications',
      query: {
        'status': _status,
        if (_severity.isNotEmpty) 'severity': _severity,
        'pageSize': '100',
      },
    );
    return listOf(data['items']);
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
      _say('$error');
    }
  }

  Future<void> _archive(Json row) async {
    try {
      await ref.read(apiClientProvider).post('/notifications/${row['id']}/archive');
      _refresh();
    } catch (error) {
      _say('$error');
    }
  }

  Future<void> _markAllRead() async {
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post('/notifications/read-all');
      _refresh();
    } catch (error) {
      _say('$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Opens the thing the alert is about.
  ///
  /// The server writes the path on the row, so the centre never has to know
  /// what a lot or an invoice is. A path this build does not have is reported
  /// rather than guessed at.
  void _open(Json row) {
    final path = text(row, 'actionPath');
    if (path.isEmpty) return;
    if (path.startsWith('/inventory/batches')) {
      context.go(AppRoutes.batches);
      return;
    }
    _say(
      _t(
        'هذا التنبيه يخص شاشة أخرى: $path',
        'This alert belongs to another screen: $path',
      ),
    );
  }

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
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
      default:
        return Icons.notifications_none_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
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
                      child: Text(
                        _t(
                          'تعذر تحميل التنبيهات: ${snapshot.error}',
                          'Notifications could not be loaded: ${snapshot.error}',
                        ),
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
                          onTap: () {
                            _open(row);
                            if (!isRead) _markRead(row);
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
                                ),
                              IconButton(
                                tooltip: _t('أرشفة', 'Archive'),
                                onPressed: () => _archive(row),
                                icon: const Icon(Icons.archive_outlined, size: 18),
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
    final count = ref.watch(notificationCountProvider).valueOrNull ?? 0;
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
