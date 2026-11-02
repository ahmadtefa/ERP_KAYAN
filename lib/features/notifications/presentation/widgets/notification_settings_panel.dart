import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Which alerts this company wants, how loud they are, who they are for, and
/// how often the same fact may be repeated.
///
/// Every rule here is one the scanner reads: switching a kind off stops it
/// being raised and closes what it used to say; the ranges decide what "close
/// to expiry" means for this shop rather than for the shop the program was
/// written in; the repeat interval is what stops an ignored warning either
/// shouting every hour or disappearing under newer news.
class NotificationSettingsPanel extends ConsumerStatefulWidget {
  const NotificationSettingsPanel({super.key});

  @override
  ConsumerState<NotificationSettingsPanel> createState() =>
      _NotificationSettingsPanelState();
}

class _NotificationSettingsPanelState extends ConsumerState<NotificationSettingsPanel> {
  Future<List<Json>>? _future;
  List<Json> _warehouses = const [];
  List<Json> _roles = const [];
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool get _canManage =>
      ref.read(currentUserProvider)?.can('notifications.manage') ?? false;
  bool get _canListRoles =>
      ref.read(currentUserProvider)?.can('admin.roles.manage') ?? false;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _loadReferences();
  }

  Future<List<Json>> _load() async {
    final data = await ref.read(apiClientProvider).get('/notifications/settings');
    return listOf(data['items']);
  }

  /// The warehouses and roles a rule can name. Both are conveniences for the
  /// picker: a person without the right to list roles can still keep the roles
  /// a rule already names, and the screen says so instead of showing nothing.
  Future<void> _loadReferences() async {
    final client = ref.read(apiClientProvider);
    try {
      final warehouses = await client.getList('/inventory/warehouses');
      if (mounted) setState(() => _warehouses = warehouses);
    } on Failure {
      // The list is optional; the rule keeps whatever it already names.
    }
    if (!_canListRoles) return;
    try {
      final roles = await client.getList('/admin/roles');
      if (mounted) setState(() => _roles = roles);
    } on Failure {
      // Same: a rule can still be saved without re-addressing it.
    }
  }

  void _refresh() => setState(() => _future = _load());

  String _typeLabel(String type) {
    switch (type) {
      case 'STOCK_EXPIRY_SOON':
        return _t('قرب انتهاء الصلاحية', 'Expiry approaching');
      case 'STOCK_EXPIRED':
        return _t('دفعة منتهية', 'Lot expired');
      case 'STOCK_BELOW_MINIMUM':
        return _t('تحت الحد الأدنى', 'Below minimum');
      case 'STOCK_OUT_OF_STOCK':
        return _t('رصيد صفر', 'Out of stock');
      case 'STOCK_ABOVE_MAXIMUM':
        return _t('أعلى من الحد الأقصى', 'Above maximum');
      case 'STOCK_EXPIRED_WRITE_OFF_PENDING':
        return _t('إعدام بانتظار قرار', 'Write-off pending');
      default:
        return type;
    }
  }

  String _severityLabel(String value) {
    switch (value) {
      case 'CRITICAL':
        return _t('حرجة', 'Critical');
      case 'WARNING':
        return _t('تحذير', 'Warning');
      default:
        return _t('معلومات', 'Info');
    }
  }

  Future<void> _save(
    Json item, {
    required bool isEnabled,
    required String severity,
    required int repeatAfterHours,
    required List<String> warehouseIds,
    required List<String> roles,
    required List<int> expiryDays,
  }) async {
    setState(() => _error = null);
    try {
      await ref.read(apiClientProvider).put(
        '/notifications/settings/${text(item, 'type')}',
        body: {
          'isEnabled': isEnabled,
          'severity': severity,
          'repeatAfterHours': repeatAfterHours,
          'warehouseIds': warehouseIds,
          'roles': roles,
          'expiryDays': expiryDays,
        },
      );
      if (!mounted) return;
      showMessage(context, _t('تم حفظ قاعدة التنبيه.', 'The alert rule was saved.'));
      _refresh();
    } on Failure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (error) {
      if (mounted) {
        setState(() => _error = '${_t('تعذر الحفظ', 'Could not save')}: $error');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canManage) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Text(
            _t(
              'تغيير قواعد التنبيهات يحتاج صلاحية إدارة التنبيهات.',
              'Changing alert rules needs the notifications management permission.',
            ),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        Expanded(
          child: FutureBuilder<List<Json>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Text('${snapshot.error}'),
                  ),
                );
              }
              final rows = snapshot.data ?? const <Json>[];
              if (rows.isEmpty) {
                return Center(
                  child: Text(_t('لا توجد أنواع تنبيهات.', 'There are no alert kinds.')),
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                itemCount: rows.length,
                separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, index) => _ruleCard(rows[index]),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _ruleCard(Json item) {
    final type = text(item, 'type');
    var isEnabled = flag(item, 'isEnabled', fallback: true);
    var severity = text(item, 'severity', fallback: text(item, 'defaultSeverity', fallback: 'INFO'));
    var repeat = asNum(item['repeatAfterHours'])?.toInt() ?? 24;
    var warehouseIds = [
      for (final value in (item['warehouseIds'] is List ? item['warehouseIds'] as List : const []))
        if (value is String) value,
    ];
    var roles = [
      for (final value in (item['roles'] is List ? item['roles'] as List : const []))
        if (value is String) value,
    ];
    var expiryDays = [
      for (final value in (item['expiryDays'] is List ? item['expiryDays'] as List : const []))
        if (value is num) value.toInt(),
    ];
    final isExpiryKind = type == 'STOCK_EXPIRY_SOON' || type == 'STOCK_EXPIRED';

    return StatefulBuilder(
      builder: (context, setCardState) {
        void apply(void Function() change) => setCardState(change);

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _typeLabel(type),
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          Text(
                            [
                              text(item, 'module'),
                              '${_t('الأصل', 'default')}: ${_severityLabel(text(item, 'defaultSeverity'))}',
                            ].join(' · '),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    Switch(
                      value: isEnabled,
                      onChanged: (value) => apply(() => isEnabled = value),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.md,
                  runSpacing: AppSpacing.sm,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    SizedBox(
                      width: 190,
                      child: DropdownButtonFormField<String>(
                        initialValue: severity,
                        decoration: InputDecoration(
                          labelText: _t('الأولوية', 'Priority'),
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                        items: [
                          for (final value in const ['CRITICAL', 'WARNING', 'INFO'])
                            DropdownMenuItem(
                              value: value,
                              child: Text(_severityLabel(value)),
                            ),
                        ],
                        onChanged: (value) =>
                            apply(() => severity = value ?? severity),
                      ),
                    ),
                    SizedBox(
                      width: 210,
                      child: TextFormField(
                        initialValue: repeat.toString(),
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText: _t('التكرار بعد (ساعات)', 'Repeat after (hours)'),
                          helperText: _t(
                            'بين ساعة و720 ساعة.',
                            'Between 1 and 720 hours.',
                          ),
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                        onChanged: (value) {
                          final parsed = int.tryParse(value.trim());
                          if (parsed != null && parsed >= 1) apply(() => repeat = parsed);
                        },
                      ),
                    ),
                  ],
                ),
                if (isExpiryKind) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    _t('نطاقات التنبيه قبل الانتهاء (أيام)', 'Warn this many days before expiry'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Wrap(
                    spacing: AppSpacing.xs,
                    children: [
                      for (final day in const [0, 7, 30, 60, 90, 180])
                        FilterChip(
                          selected: expiryDays.contains(day),
                          label: Text(day == 0 ? _t('يوم الانتهاء', 'On the day') : '$day'),
                          onSelected: (selected) => apply(() {
                            if (selected) {
                              if (!expiryDays.contains(day)) expiryDays = [...expiryDays, day];
                            } else {
                              expiryDays = expiryDays.where((value) => value != day).toList();
                            }
                          }),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: AppSpacing.sm),
                if (_warehouses.isNotEmpty) ...[
                  Text(
                    _t('مخازن بعينها (فارغ = كل المخازن)', 'Only these warehouses (empty = all)'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Wrap(
                    spacing: AppSpacing.xs,
                    runSpacing: AppSpacing.xs,
                    children: [
                      for (final warehouse in _warehouses)
                        FilterChip(
                          selected: warehouseIds.contains(text(warehouse, 'id')),
                          label: Text(text(warehouse, 'code')),
                          onSelected: (selected) => apply(() {
                            final id = text(warehouse, 'id');
                            warehouseIds = selected
                                ? [...warehouseIds, id]
                                : warehouseIds.where((value) => value != id).toList();
                          }),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                Text(
                  _t('يُوجَّه إلى أدوار بعينها (فارغ = كل من يملك الصلاحية)', 'Addressed to these roles (empty = anyone holding the permission)'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: AppSpacing.xs),
                if (_roles.isEmpty)
                  Text(
                    roles.isEmpty
                        ? _t(
                            'لا تُوجَّه هذه التنبيهات إلى دور معين.',
                            'These alerts are not addressed to a particular role.',
                          )
                        : _t(
                            'مسندة إلى: ${roles.join(', ')}. تحتاج صلاحية إدارة الأدوار لتغييرها.',
                            'Addressed to: ${roles.join(', ')}. Changing that needs the role management permission.',
                          ),
                    style: Theme.of(context).textTheme.bodySmall,
                  )
                else
                  Wrap(
                    spacing: AppSpacing.xs,
                    runSpacing: AppSpacing.xs,
                    children: [
                      for (final role in _roles)
                        FilterChip(
                          selected: roles.contains(text(role, 'code')),
                          label: Text(text(role, 'code')),
                          onSelected: (selected) => apply(() {
                            final code = text(role, 'code');
                            roles = selected
                                ? [...roles, code]
                                : roles.where((value) => value != code).toList();
                          }),
                        ),
                    ],
                  ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (!isEnabled)
                      Padding(
                        padding: const EdgeInsetsDirectional.only(end: AppSpacing.sm),
                        child: Text(
                          _t('موقوف: لا يُرفع ولا يبقى قديمه.', 'Off: nothing is raised, and its old rows are closed.'),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    FilledButton.tonal(
                      key: ValueKey('notification-save-$type'),
                      onPressed: () => _save(
                        item,
                        isEnabled: isEnabled,
                        severity: severity,
                        repeatAfterHours: repeat,
                        warehouseIds: warehouseIds,
                        roles: roles,
                        expiryDays: isExpiryKind ? expiryDays : const [],
                      ),
                      child: Text(_t('حفظ', 'Save')),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
