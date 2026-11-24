import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

final companySettingsProvider = FutureProvider<Json>((ref) async {
  return ref.read(apiClientProvider).getObject('/accounting/settings');
});

/// The company choices that change what a quotation shows and what discount it
/// will accept.
///
/// Reading the settings needs report access; changing them needs the
/// installation super administrator. The card shows the values either way and simply does not
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
  final _errors = <String, String>{};
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
        _maxDiscount.text = text(
          settings,
          'maxDiscountPercent',
          fallback: '100.0000',
        );
        _manager.text = text(settings, 'managerName');
        _salesManager.text = text(settings, 'salesManagerName');
        _salesPhone.text = text(settings, 'salesManagerPhone');
        _showTaxId = flag(settings, 'showTaxIdOnQuotations', fallback: true);
      });
    });
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    final raw = _maxDiscount.text.trim();
    final percent = double.tryParse(raw);
    final errors = <String, String>{};
    if (!RegExp(r'^\d{1,3}(\.\d{1,4})?$').hasMatch(raw) ||
        percent == null ||
        !percent.isFinite ||
        percent < 0 ||
        percent > 100) {
      errors['maxDiscountPercent'] = l10n.invalidSetting;
    }
    for (final entry in {
      'managerName': _manager,
      'salesManagerName': _salesManager,
      'salesManagerPhone': _salesPhone,
    }.entries) {
      if (entry.value.text.trim().length > 160) {
        errors[entry.key] = Localizations.localeOf(context).languageCode == 'ar'
            ? 'الحد الأقصى 160 حرفًا'
            : 'Use no more than 160 characters';
      }
    }
    setState(() {
      _errors
        ..clear()
        ..addAll(errors);
    });
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      await ref
          .read(apiClientProvider)
          .patch(
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
        showMessage(context, l10n.settingsSaved);
      }
    } on Failure catch (error) {
      if (mounted) {
        if (error is ApiFailure && error.fieldErrors.isNotEmpty) {
          const fields = {
            'maxDiscountPercent',
            'managerName',
            'salesManagerName',
            'salesManagerPhone',
          };
          setState(() {
            _errors.addAll({
              for (final entry in error.fieldErrors.entries)
                if (fields.contains(entry.key)) entry.key: entry.value,
            });
          });
          if (error.fieldErrors.keys.every(fields.contains)) return;
        }
        showMessage(context, error, error: true);
      }
    } catch (error) {
      if (mounted) {
        // Anything that is not a Failure still goes through the central
        // dialog, which decides what a user may be told.
        showAppError(context, error);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final canEdit = user?.isSuperAdmin == true;
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
          // The panel is not a SnackBar, but it still must not print a
          // transport error: the same resolver explains it.
          error: (error, _) => Text(presentErrorText(context, error)),
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
                        onChanged: (_) {
                          if (_errors.remove('maxDiscountPercent') != null) {
                            setState(() {});
                          }
                        },
                        enabled: canEdit,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.maximumDiscount,
                          errorText: _errors['maxDiscountPercent'],
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 230,
                      child: TextField(
                        controller: _manager,
                        onChanged: (_) {
                          if (_errors.remove('managerName') != null) {
                            setState(() {});
                          }
                        },
                        enabled: canEdit,
                        decoration: InputDecoration(
                          labelText: l10n.managerName,
                          errorText: _errors['managerName'],
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 230,
                      child: TextField(
                        controller: _salesManager,
                        onChanged: (_) {
                          if (_errors.remove('salesManagerName') != null) {
                            setState(() {});
                          }
                        },
                        enabled: canEdit,
                        decoration: InputDecoration(
                          labelText: l10n.salesManagerName,
                          errorText: _errors['salesManagerName'],
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 210,
                      child: TextField(
                        controller: _salesPhone,
                        onChanged: (_) {
                          if (_errors.remove('salesManagerPhone') != null) {
                            setState(() {});
                          }
                        },
                        enabled: canEdit,
                        decoration: InputDecoration(
                          labelText: l10n.salesManagerPhone,
                          errorText: _errors['salesManagerPhone'],
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
