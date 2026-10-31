import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/print_settings_data_source.dart';
import '../providers/print_settings_providers.dart';

/// What a printed copy carries, per kind of print.
///
/// The dialog in front of every print button asks the same question, but it
/// asks it every time, and the answer used to be forgotten the moment the
/// window closed. This screen is where a company decides once: a warehouse
/// sheet leaves without costs, a quotation leaves with the sale price and
/// without the cost, an invoice keeps both. It is stored in the database, so it
/// survives a reinstall, travels in a backup and means the same thing at every
/// station.
///
/// Hiding never changes a stored price and never changes a permission: it
/// applies to the rendered copy on its way out, and a caller without
/// `inventory.cost.read` is refused a cost whatever is saved here - which is
/// why the cost switches are disabled for such a caller with the reason shown.
class PrintSettingsScreen extends ConsumerStatefulWidget {
  const PrintSettingsScreen({super.key});

  @override
  ConsumerState<PrintSettingsScreen> createState() => _PrintSettingsScreenState();
}

class _PrintSettingsScreenState extends ConsumerState<PrintSettingsScreen> {
  /// Edits not yet saved, keyed by print type. Absent means "as stored".
  final Map<String, PrintPriceSetting> _edits = {};
  bool _saving = false;
  String? _error;
  String? _saved;

  bool get _arabic =>
      Localizations.localeOf(context).languageCode == 'ar';

  PrintPriceSetting _valueFor(PrintSettings settings, String key) =>
      _edits[key] ?? settings.forType(key);

  void _set(String key, PrintPriceSetting value) {
    setState(() {
      _edits[key] = value;
      _saved = null;
    });
  }

  Future<void> _save() async {
    if (_edits.isEmpty) {
      setState(() => _error = _arabic
          ? 'لا يوجد تغيير لحفظه.'
          : 'There is nothing to save.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final message = await ref
        .read(printSettingsControllerProvider.notifier)
        .save(Map<String, PrintPriceSetting>.from(_edits));
    if (!mounted) return;
    setState(() {
      _saving = false;
      _error = message;
      _saved = message == null
          ? (_arabic ? 'تم الحفظ في قاعدة البيانات.' : 'Saved to the database.')
          : null;
      if (message == null) _edits.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final arabic = _arabic;
    final async = ref.watch(printSettingsControllerProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          title: arabic ? 'إعدادات الطباعة' : 'Print settings',
          subtitle: arabic
              ? 'ما تحمله كل نسخة مطبوعة أو PDF: سعر البيع، التكلفة، أو الاثنان.'
              : 'What every printed or PDF copy carries: the sale price, the cost, or both.',
        ),
        Container(height: 1, color: Theme.of(context).colorScheme.outlineVariant),
        Expanded(
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.xxl),
                child: Text(
                  arabic
                      ? 'تعذّر تحميل إعدادات الطباعة: $error'
                      : 'The print settings could not be loaded: $error',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
            data: (settings) => _body(settings, arabic),
          ),
        ),
      ],
    );
  }

  Widget _body(PrintSettings settings, bool arabic) {
    final groups = <String, List<PrintType>>{};
    for (final type in settings.types) {
      groups.putIfAbsent(type.category, () => []).add(type);
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 980),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (settings.costLocked)
                Card(
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: ListTile(
                    leading: const Icon(Icons.lock_outline),
                    title: Text(
                      arabic
                          ? 'صلاحيتك لا تتيح رؤية التكلفة'
                          : 'Your role may not view costs',
                    ),
                    subtitle: Text(
                      arabic
                          ? 'ستُطبع كل النسخ بدون تكلفة، ولا يمكن تجاوز ذلك من هنا. '
                                'الإعداد المحفوظ لا يُحذف ولا يُلغى.'
                          : 'Every copy will be printed without a cost, and this screen '
                                'cannot override that. The saved setting is not deleted.',
                    ),
                  ),
                ),
              if (settings.costLocked) const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        arabic ? 'الافتراضي للشركة' : 'Company default',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        arabic
                            ? 'يُطبَّق على أي نوع طباعة لم يُضبط له اختيار خاص.'
                            : 'Applies to every print type that has no choice of its own.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      _switches(
                        key: 'default',
                        type: const PrintType(
                          key: 'default',
                          category: 'DEFAULT',
                          labelEn: 'Default',
                          labelAr: 'الافتراضي',
                          carriesSalePrice: true,
                          carriesCost: true,
                        ),
                        value: _valueFor(settings, 'default'),
                        settings: settings,
                        arabic: arabic,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              for (final category in _categoryOrder)
                if (groups[category] != null) ...[
                  Text(
                    _categoryLabel(category, arabic),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Card(
                    child: Column(
                      children: [
                        for (final type in groups[category]!)
                          _switches(
                            key: type.key,
                            type: type,
                            value: _valueFor(settings, type.key),
                            settings: settings,
                            arabic: arabic,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              if (_error != null)
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              if (_saved != null)
                Text(
                  _saved!,
                  style: TextStyle(color: Theme.of(context).colorScheme.primary),
                ),
              const SizedBox(height: 8),
              Text(
                arabic
                    ? 'هذه الإعدادات تُحفظ في قاعدة البيانات، فتبقى بعد إعادة التشغيل '
                          'ومع أي نسخة احتياطية. إخفاء السعر أو التكلفة لا يحذف أي بيانات '
                          'ولا يغيّر أي صلاحية؛ يخصّ النسخة المطبوعة فقط.'
                    : 'These settings are stored in the database, so they survive a restart '
                          'and travel in a backup. Hiding a price or a cost deletes no data '
                          'and changes no permission; it applies to the printed copy only.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: [
                  FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_outlined, size: 18),
                    label: Text(arabic ? 'حفظ' : 'Save'),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton.icon(
                    onPressed: _saving
                        ? null
                        : () {
                            setState(() {
                              _edits.clear();
                              _error = null;
                              _saved = null;
                            });
                            ref.invalidate(printSettingsControllerProvider);
                          },
                    icon: const Icon(Icons.refresh, size: 18),
                    label: Text(arabic ? 'إلغاء التغييرات' : 'Discard changes'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _switches({
    required String key,
    required PrintType type,
    required PrintPriceSetting value,
    required PrintSettings settings,
    required bool arabic,
  }) {
    final canSeeCost = !settings.costLocked;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (type.carriesSalePrice)
          SwitchListTile(
            value: value.showSalePrice,
            title: Text(
              '${arabic ? 'إظهار سعر البيع' : 'Show sale price'} — ${type.label(arabic)}',
            ),
            onChanged: (on) =>
                _set(key, value.copyWith(showSalePrice: on)),
          ),
        if (type.carriesCost)
          SwitchListTile(
            value: canSeeCost && value.showCost,
            title: Text(
              '${arabic ? 'إظهار التكلفة' : 'Show cost'} — ${type.label(arabic)}',
            ),
            subtitle: canSeeCost
                ? null
                : Text(
                    arabic
                        ? 'محجوب بصلاحية inventory.cost.read'
                        : 'Blocked by the inventory.cost.read permission',
                  ),
            onChanged: canSeeCost
                ? (on) => _set(key, value.copyWith(showCost: on))
                : null,
          ),
      ],
    );
  }

  static const _categoryOrder = ['DOCUMENT', 'STOCK', 'LIST', 'REPORT', 'LABEL'];

  static String _categoryLabel(String category, bool arabic) => switch (category) {
    'DOCUMENT' => arabic ? 'المستندات المحفوظة' : 'Saved documents',
    'STOCK' => arabic ? 'المستندات المخزنية' : 'Stock documents',
    'LIST' => arabic ? 'القوائم' : 'Lists',
    'REPORT' => arabic ? 'التقارير' : 'Reports',
    'LABEL' => arabic ? 'الملصقات' : 'Labels',
    _ => category,
  };
}
