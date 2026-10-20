import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

final companySettingsProvider = FutureProvider<Json>((ref) async {
  return ref.read(apiClientProvider).getObject('/accounting/settings');
});

/// The company choices that change what a quotation shows and what discount it
/// will accept.
///
/// Reading the settings needs report access; changing them needs company
/// administration. The card shows the values either way and simply does not
/// offer a save button to someone the server would refuse.
class DocumentSettingsCard extends ConsumerStatefulWidget {
  const DocumentSettingsCard({super.key});

  @override
  ConsumerState<DocumentSettingsCard> createState() =>
      _DocumentSettingsCardState();
}

class _DocumentSettingsCardState extends ConsumerState<DocumentSettingsCard> {
  final _maxDiscount = TextEditingController();
  final _manager = TextEditingController();
  final _salesManager = TextEditingController();
  final _salesPhone = TextEditingController();
  bool _showTaxId = true;
  bool _loaded = false;
  bool _saving = false;

  @override
  void dispose() {
    _maxDiscount.dispose();
    _manager.dispose();
    _salesManager.dispose();
    _salesPhone.dispose();
    super.dispose();
  }

  /// Fills the fields once, after the frame: a controller that notifies its
  /// field in the middle of a build would be a setState during build.
  void _fill(Json settings) {
    if (_loaded) return;
    _loaded = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() {
        _maxDiscount.text =
            text(settings, 'maxDiscountPercent', fallback: '100.0000');
        _manager.text = text(settings, 'managerName');
        _salesManager.text = text(settings, 'salesManagerName');
        _salesPhone.text = text(settings, 'salesManagerPhone');
        _showTaxId = flag(settings, 'showTaxIdOnQuotations', fallback: true);
      });
    });
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    final percent = double.tryParse(_maxDiscount.text.trim());
    if (percent == null || percent < 0 || percent > 100) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.invalidSetting)),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(apiClientProvider).patch(
        '/accounting/settings',
        body: {
          'maxDiscountPercent': _maxDiscount.text.trim(),
          'showTaxIdOnQuotations': _showTaxId,
          'managerName': _manager.text.trim(),
          'salesManagerName': _salesManager.text.trim(),
          'salesManagerPhone': _salesPhone.text.trim(),
        },
      );
      ref.invalidate(companySettingsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.settingsSaved)),
        );
      }
    } on Failure catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final canEdit = user?.can('admin.company.manage') ?? false;
    final canRead = user?.can('reports.read') ?? false;
    if (!canRead) return const SizedBox.shrink();
    final async = ref.watch(companySettingsProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: async.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(12),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (error, _) => Text('$error'),
          data: (settings) {
            _fill(settings);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.documentSettings,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    SizedBox(
                      width: 190,
                      child: TextField(
                        controller: _maxDiscount,
                        enabled: canEdit,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.maximumDiscount,
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 230,
                      child: TextField(
                        controller: _manager,
                        enabled: canEdit,
                        decoration: InputDecoration(
                          labelText: l10n.managerName,
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 230,
                      child: TextField(
                        controller: _salesManager,
                        enabled: canEdit,
                        decoration: InputDecoration(
                          labelText: l10n.salesManagerName,
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 210,
                      child: TextField(
                        controller: _salesPhone,
                        enabled: canEdit,
                        decoration: InputDecoration(
                          labelText: l10n.salesManagerPhone,
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _showTaxId,
                  onChanged: canEdit
                      ? (value) => setState(() => _showTaxId = value)
                      : null,
                  title: Text(l10n.showTaxIdOnQuotations),
                  subtitle: Text(l10n.taxIdLegalNote),
                ),
                if (!canEdit)
                  Text(
                    l10n.readOnlySettings,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (canEdit)
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: const Icon(Icons.save_outlined),
                      label: Text(l10n.saveSettings),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
