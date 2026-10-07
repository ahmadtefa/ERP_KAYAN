import 'package:flutter/material.dart';

import '../../../../shared/extensions/l10n_extension.dart';

/// Standard header above a module screen: title, actions and the body.
class ModuleScaffold extends StatelessWidget {
  const ModuleScaffold({
    super.key,
    required this.title,
    required this.body,
    this.actions = const [],
    this.trailing,
  });

  final String title;
  final Widget body;
  final List<Widget> actions;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(title, style: theme.textTheme.titleLarge),
              ),
              ?trailing,
              for (final action in actions) ...[
                const SizedBox(width: 8),
                action,
              ],
            ],
          ),
        ),
        Expanded(child: body),
      ],
    );
  }
}

/// A search box shared by every list screen.
class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    required this.hint,
    required this.onChanged,
    this.controller,
  });

  final String hint;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 280,
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        decoration: InputDecoration(
          hintText: hint,
          isDense: true,
          prefixIcon: const Icon(Icons.search, size: 20),
          border: const OutlineInputBorder(),
        ),
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
        content: Text(message),
        backgroundColor: error ? scheme.error : null,
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
