import 'package:flutter/material.dart';

import 'field_option.dart';

/// A named, searchable choice field for reference values such as company,
/// branch, warehouse, role, and unit. It stores the selected ID but never
/// asks a person to type one.
class SearchableSelectField extends StatelessWidget {
  const SearchableSelectField({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    required this.decoration,
    this.fieldKey,
    this.validator,
    this.enabled = true,
  });

  final String? value;
  final List<FieldOption> options;
  final ValueChanged<String?> onChanged;
  final InputDecoration decoration;
  final GlobalKey<FormFieldState>? fieldKey;
  final FormFieldValidator<String>? validator;
  final bool enabled;

  @override
  Widget build(BuildContext context) => FormField<String>(
    key: fieldKey,
    initialValue: value,
    validator: validator,
    builder: (state) {
      final selected = options.where((option) => option.value == state.value);
      final label = selected.isEmpty ? null : selected.first.label;
      return InkWell(
        onTap: !enabled
            ? null
            : () async {
                final choice = await showDialog<String>(
                  context: context,
                  builder: (_) => _SearchableOptionsDialog(
                    title: decoration.labelText ?? '',
                    options: options,
                    selectedValue: state.value,
                  ),
                );
                if (choice == null) return;
                state.didChange(choice);
                onChanged(choice);
              },
        borderRadius: BorderRadius.circular(12),
        child: InputDecorator(
          isEmpty: label == null,
          decoration: decoration.copyWith(
            enabled: enabled,
            errorText: state.errorText,
            suffixIcon: const Icon(Icons.search_rounded),
          ),
          child: Text(
            label ?? '',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      );
    },
  );
}

class _SearchableOptionsDialog extends StatefulWidget {
  const _SearchableOptionsDialog({
    required this.title,
    required this.options,
    required this.selectedValue,
  });

  final String title;
  final List<FieldOption> options;
  final String? selectedValue;

  @override
  State<_SearchableOptionsDialog> createState() =>
      _SearchableOptionsDialogState();
}

class _SearchableOptionsDialogState extends State<_SearchableOptionsDialog> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = widget.options
        .where((option) {
          final query = _query.text.trim().toLowerCase();
          return query.isEmpty || option.label.toLowerCase().contains(query);
        })
        .toList(growable: false);

    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 520,
        height: 420,
        child: Column(
          children: [
            TextField(
              controller: _query,
              autofocus: true,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search_rounded),
                hintText: MaterialLocalizations.of(context).searchFieldLabel,
                suffixIcon: _query.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: MaterialLocalizations.of(context)
                            .deleteButtonTooltip,
                        onPressed: () => setState(_query.clear),
                        icon: const Icon(Icons.clear_rounded),
                      ),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: filtered.isEmpty
                  ? Center(
                      child: Text(
                        MaterialLocalizations.of(context).searchFieldLabel,
                      ),
                    )
                  : ListView.builder(
                      itemCount: filtered.length,
                      itemBuilder: (context, index) {
                        final option = filtered[index];
                        return ListTile(
                          enabled: option.enabled,
                          selected: option.value == widget.selectedValue,
                          title: Text(option.label),
                          onTap: option.enabled
                              ? () => Navigator.pop(context, option.value)
                              : null,
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
        ),
      ],
    );
  }
}
