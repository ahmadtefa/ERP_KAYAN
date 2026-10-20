import 'package:flutter/material.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/page_header.dart';

/// Standard header above a module screen: title, actions and the body.
///
/// Every list screen in the program goes through this widget, which is what
/// makes the header, the action placement and the spacing identical whether
/// you open customers, budgets or the chart of accounts.
class ModuleScaffold extends StatelessWidget {
  const ModuleScaffold({
    super.key,
    required this.title,
    required this.body,
    this.actions = const [],
    this.trailing,
    this.subtitle,
    this.eyebrow,
    this.leading,
    this.denseHeader = false,
  });

  final String title;
  final String? subtitle;

  /// The module family shown above the title, e.g. "Accounting".
  final String? eyebrow;
  final Widget body;
  final List<Widget> actions;
  final Widget? trailing;
  final Widget? leading;
  final bool denseHeader;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          title: title,
          subtitle: subtitle,
          eyebrow: eyebrow,
          leading: leading,
          dense: denseHeader,
          actions: [
            ?trailing,
            ...actions,
          ],
        ),
        Container(
          height: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        Expanded(child: body),
      ],
    );
  }
}

/// A search box shared by every list screen.
///
/// It owns its controller when the screen does not supply one, so the clear
/// button can work without every caller adding state for it.
class SearchField extends StatefulWidget {
  const SearchField({
    super.key,
    required this.hint,
    required this.onChanged,
    this.controller,
    this.width = 300,
  });

  final String hint;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;
  final double width;

  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> {
  TextEditingController? _owned;

  TextEditingController get _controller =>
      widget.controller ?? (_owned ??= TextEditingController());

  @override
  void dispose() {
    _owned?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      width: widget.width,
      child: ValueListenableBuilder<TextEditingValue>(
        valueListenable: _controller,
        builder: (context, value, _) {
          return TextField(
            controller: _controller,
            onChanged: widget.onChanged,
            style: Theme.of(context).textTheme.bodyMedium,
            decoration: InputDecoration(
              hintText: widget.hint,
              isDense: true,
              filled: true,
              fillColor: scheme.surfaceContainerLow,
              prefixIcon: const Icon(Icons.search_rounded, size: 18),
              suffixIcon: value.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: MaterialLocalizations.of(context).deleteButtonTooltip,
                      icon: const Icon(Icons.close_rounded, size: 16),
                      onPressed: () {
                        _controller.clear();
                        widget.onChanged('');
                      },
                    ),
              border: OutlineInputBorder(
                borderRadius: AppRadii.control,
                borderSide: BorderSide(color: scheme.outlineVariant),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: AppRadii.control,
                borderSide: BorderSide(color: scheme.outlineVariant),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: 10,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Shows a short message at the bottom of the screen.
void showMessage(BuildContext context, String message, {bool error = false}) {
  final scheme = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              error
                  ? Icons.error_outline_rounded
                  : Icons.check_circle_outline_rounded,
              size: 18,
              color: Colors.white,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: error ? scheme.error : AppColors.navy,
      ),
    );
}

/// Turns any thrown object into something worth showing a user.
String describeError(BuildContext context, Object error) {
  final text = error.toString();
  // Failures already carry a human-readable message; strip the wrapper.
  final match = RegExp(r'^[A-Za-z]+Failure: (.*)$').firstMatch(text);
  return match?.group(1) ?? (text.isEmpty ? context.l10n.operationFailed : text);
}
