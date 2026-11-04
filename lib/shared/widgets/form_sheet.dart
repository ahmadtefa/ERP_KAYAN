import 'dart:convert';

import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';
import '../../core/json/json_utils.dart';
import '../extensions/l10n_extension.dart';
import 'confirm_dialog.dart';
import 'app_error_dialog.dart';

/// What kind of input a field collects.
enum FieldKind { text, multiline, decimal, integer, date, toggle, select, multiSelect }

/// One choice in a [FieldKind.select] field.
class FieldOption {
  const FieldOption(this.value, this.label);

  final String value;
  final String label;
}

/// Declarative description of one input in a [showFormSheet].
///
/// Screens describe their fields and get a validated map back, so every form
/// in the application validates, lays out and cancels the same way.
class FieldSpec {
  const FieldSpec(
    this.key,
    this.label, {
    this.kind = FieldKind.text,
    this.required = false,
    this.helper,
    this.options = const [],
    this.maxLines = 1,
    this.emptyValue,
  });

  final String key;
  final String label;
  final FieldKind kind;
  final bool required;
  final String? helper;
  final List<FieldOption> options;
  final int maxLines;
  /// Explicit payload when an optional field is blank; null keeps omission.
  final String? emptyValue;
}

/// Opens a modal form built from [fields].
///
/// Returns the entered values keyed by [FieldSpec.key], or null if the user
/// cancelled. Amounts are returned as the exact text the user typed; nothing
/// is converted to a double.
Future<Json?> showFormSheet(
  BuildContext context, {
  required String title,
  required List<FieldSpec> fields,
  Json? initial,
  String? submitLabel,
  bool readOnly = false,
  Future<void> Function(Json values)? onSubmit,
}) {
  return showDialog<Json>(
    context: context,
    barrierDismissible: false,
    builder: (context) => _FormSheet(
      title: title,
      fields: fields,
      initial: initial ?? const {},
      submitLabel: submitLabel,
      readOnly: readOnly,
      onSubmit: onSubmit,
    ),
  );
}

class _FormSheet extends StatefulWidget {
  const _FormSheet({
    required this.title,
    required this.fields,
    required this.initial,
    this.submitLabel,
    this.readOnly = false,
    this.onSubmit,
  });

  final String title;
  final List<FieldSpec> fields;
  final Json initial;
  final String? submitLabel;
  final bool readOnly;
  final Future<void> Function(Json values)? onSubmit;

  @override
  State<_FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<_FormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _controllers = <String, TextEditingController>{};
  final _toggles = <String, bool>{};
  final _selections = <String, String?>{};
  final _multiSelections = <String, Set<String>>{};
  late final String _initialSnapshot;
  bool _confirmingExit = false, _saving = false;

  @override
  void initState() {
    super.initState();
    for (final field in widget.fields) {
      final raw = widget.initial[field.key];
      switch (field.kind) {
        case FieldKind.toggle:
          _toggles[field.key] = raw is bool ? raw : false;
        case FieldKind.select:
          _selections[field.key] = raw?.toString();
        case FieldKind.multiSelect:
          _multiSelections[field.key] = raw is List
              ? raw.map((value) => value.toString()).toSet()
              : <String>{};
        case FieldKind.date:
          _controllers[field.key] = TextEditingController(
            text: raw?.toString().split('T').first ?? '',
          );
        default:
          _controllers[field.key] = TextEditingController(
            text: raw?.toString() ?? '',
          );
      }
    }
    _initialSnapshot = _snapshot();
  }

  String _snapshot() => jsonEncode({
    'text': {for (final entry in _controllers.entries) entry.key: entry.value.text},
    'toggles': _toggles,
    'selections': _selections,
    'multi': {for (final entry in _multiSelections.entries) entry.key: (entry.value.toList()..sort())},
  });

  Future<void> _close() async {
    if (_confirmingExit || _saving) return;
    if (!widget.readOnly && _snapshot() != _initialSnapshot) {
      _confirmingExit = true;
      try {
        final arabic = Localizations.localeOf(context).languageCode == 'ar';
        final discard = await confirmAction(context,
          title: arabic ? 'تغييرات غير محفوظة' : 'Unsaved changes',
          message: arabic ? 'الخروج دون حفظ المدخلات؟' : 'Leave without saving your changes?',
          confirmLabel: arabic ? 'الخروج دون حفظ' : 'Discard changes',destructive:true);
        if (!discard || !mounted) return;
      } finally { _confirmingExit = false; }
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String? _validate(FieldSpec field, String? value) {
    final text = value?.trim() ?? '';
    if (field.required && text.isEmpty) return context.l10n.requiredField;
    if (text.isEmpty) return null;
    switch (field.kind) {
      case FieldKind.decimal:
        // Amounts stay text all the way to the API, so validate the shape
        // rather than parsing into a double.
        if (!RegExp(r'^\d{1,15}(\.\d{1,4})?$').hasMatch(text)) {
          return context.l10n.invalidNumber;
        }
      case FieldKind.integer:
        if (!RegExp(r'^\d{1,9}$').hasMatch(text)) {
          return context.l10n.invalidNumber;
        }
      default:
        break;
    }
    return null;
  }

  Future<void> _pickDate(FieldSpec field) async {
    final controller = _controllers[field.key]!;
    final now = DateTime.now();
    final initial = DateTime.tryParse(controller.text) ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) {
      controller.text =
          '${picked.year.toString().padLeft(4, '0')}-'
          '${picked.month.toString().padLeft(2, '0')}-'
          '${picked.day.toString().padLeft(2, '0')}';
    }
  }

  Future<void> _submit() async {
    if (_saving || _confirmingExit || !(_formKey.currentState?.validate() ?? false)) return;
    final result = <String, dynamic>{};
    for (final field in widget.fields) {
      switch (field.kind) {
        case FieldKind.toggle:
          result[field.key] = _toggles[field.key] ?? false;
        case FieldKind.select:
          final value = _selections[field.key];
          if (value != null && value.isNotEmpty) result[field.key] = value;
        case FieldKind.multiSelect:
          // Sent even when empty, because clearing every choice is a
          // meaningful edit: a user with no roles, a role with no rights.
          result[field.key] = (_multiSelections[field.key] ?? <String>{})
              .toList(growable: false);
        default:
          final text = _controllers[field.key]!.text.trim();
          if (text.isNotEmpty) {
            result[field.key] = text;
          } else if (field.emptyValue != null) {
            result[field.key] = field.emptyValue;
          }
      }
    }
    if (widget.onSubmit == null) {
      Navigator.of(context).pop(result);
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.onSubmit!(result);
      if (mounted) Navigator.of(context).pop(result);
    } catch (error) {
      if (mounted) await showAppError(context,error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return PopScope(canPop:false,onPopInvokedWithResult:(didPop,_) { if (!didPop) _close(); },
      child:AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          padding: const EdgeInsets.only(top: AppSpacing.xs),
          child: AbsorbPointer(absorbing:_saving,child:Form(
            key: _formKey,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final field in widget.fields) _buildField(field),
              ],
            ),
          )),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : _close,
          child: Text(widget.readOnly ? l10n.close : l10n.cancel),
        ),
        if (!widget.readOnly)
          FilledButton(
            onPressed: _saving ? null : _submit,
            child: Text(widget.submitLabel ?? l10n.save),
          ),
      ],
    ));
  }

  Widget _buildField(FieldSpec field) {
    final padding = const EdgeInsets.only(bottom: AppSpacing.md);
    switch (field.kind) {
      case FieldKind.toggle:
        return Padding(
          padding: padding,
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(field.label),
            subtitle: field.helper == null ? null : Text(field.helper!),
            value: _toggles[field.key] ?? false,
            onChanged: widget.readOnly
                ? null
                : (value) => setState(() => _toggles[field.key] = value),
          ),
        );
      case FieldKind.select:
        return Padding(
          padding: padding,
          child: DropdownButtonFormField<String>(
            // Expanded, or the button sizes to its widest option and
            // a long label (an account, a purchase line) overflows
            // the field instead of ellipsising inside it.
            isExpanded: true,
            initialValue: _selections[field.key],
            decoration: InputDecoration(
              labelText: field.label,
              helperText: field.helper,
            ),
            items: [
              for (final option in field.options)
                DropdownMenuItem(value: option.value, child: Text(option.label)),
            ],
            validator: field.required
                ? (value) => (value == null || value.isEmpty)
                      ? context.l10n.requiredField
                      : null
                : null,
            onChanged: widget.readOnly
                ? null
                : (value) => setState(() => _selections[field.key] = value),
          ),
        );
      case FieldKind.multiSelect:
      return Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              field.label,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            if (field.helper != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  field.helper!,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.xs,
              children: [
                for (final option in field.options)
                  FilterChip(
                    label: Text(option.label),
                    selected:
                        _multiSelections[field.key]?.contains(option.value) ??
                        false,
                    onSelected: widget.readOnly
                        ? null
                        : (selected) => setState(() {
                            final chosen =
                                _multiSelections[field.key] ?? <String>{};
                            if (selected) {
                              chosen.add(option.value);
                            } else {
                              chosen.remove(option.value);
                            }
                            _multiSelections[field.key] = chosen;
                          }),
                  ),
              ],
            ),
          ],
        ),
      );
      case FieldKind.date:
        return Padding(
          padding: padding,
          child: TextFormField(
            controller: _controllers[field.key],
            readOnly: true,
            decoration: InputDecoration(
              labelText: field.label,
              helperText: field.helper,
              suffixIcon: const Icon(Icons.calendar_today_outlined),
            ),
            onTap: widget.readOnly ? null : () => _pickDate(field),
            validator: (value) => _validate(field, value),
          ),
        );
      default:
        return Padding(
          padding: padding,
          child: TextFormField(
            controller: _controllers[field.key],
            readOnly: widget.readOnly,
            maxLines: field.kind == FieldKind.multiline ? field.maxLines : 1,
            keyboardType: switch (field.kind) {
              FieldKind.decimal => const TextInputType.numberWithOptions(
                decimal: true,
              ),
              FieldKind.integer => TextInputType.number,
              _ => TextInputType.text,
            },
            decoration: InputDecoration(
              labelText: field.label,
              helperText: field.helper,
            ),
            validator: (value) => _validate(field, value),
          ),
        );
    }
  }
}
