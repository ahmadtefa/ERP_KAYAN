import 'package:flutter/material.dart';

import '../../core/json/json_utils.dart';
import '../extensions/l10n_extension.dart';

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
  });

  final String key;
  final String label;
  final FieldKind kind;
  final bool required;
  final String? helper;
  final List<FieldOption> options;
  final int maxLines;
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
}) {
  return showDialog<Json>(
    context: context,
    builder: (context) => _FormSheet(
      title: title,
      fields: fields,
      initial: initial ?? const {},
      submitLabel: submitLabel,
      readOnly: readOnly,
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
  });

  final String title;
  final List<FieldSpec> fields;
  final Json initial;
  final String? submitLabel;
  final bool readOnly;

  @override
  State<_FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<_FormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _controllers = <String, TextEditingController>{};
  final _toggles = <String, bool>{};
  final _selections = <String, String?>{};
  final _multiSelections = <String, Set<String>>{};

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

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
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
          if (text.isNotEmpty) result[field.key] = text;
      }
    }
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final field in widget.fields) _buildField(field),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(widget.readOnly ? l10n.close : l10n.cancel),
        ),
        if (!widget.readOnly)
          FilledButton(
            onPressed: _submit,
            child: Text(widget.submitLabel ?? l10n.save),
          ),
      ],
    );
  }

  Widget _buildField(FieldSpec field) {
    final padding = const EdgeInsets.only(bottom: 12);
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
            initialValue: _selections[field.key],
            decoration: InputDecoration(
              labelText: field.label,
              helperText: field.helper,
              border: const OutlineInputBorder(),
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
            Text(field.label, style: Theme.of(context).textTheme.labelLarge),
            if (field.helper != null)
              Text(field.helper!, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 4,
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
              border: const OutlineInputBorder(),
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
              border: const OutlineInputBorder(),
            ),
            validator: (value) => _validate(field, value),
          ),
        );
    }
  }
}
