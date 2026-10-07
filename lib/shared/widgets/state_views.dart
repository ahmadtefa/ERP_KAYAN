import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../extensions/l10n_extension.dart';

/// Standard loading indicator with an accessible label.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(message ?? context.l10n.loading),
        ],
      ),
    );
  }
}

/// Shown when an operation fails. Always offers a retry affordance.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: scheme.error),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              FilledButton.tonalIcon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(context.l10n.retry),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Shown when a request succeeded but produced no records.
class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.message, this.icon = Icons.inbox});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: scheme.outline),
          const SizedBox(height: 12),
          Text(message, style: Theme.of(context).textTheme.bodyLarge),
        ],
      ),
    );
  }
}

/// Renders the four canonical states of an [AsyncValue]: loading, error,
/// empty and data. Screens use this so every list behaves consistently.
class AsyncStateView<T> extends StatelessWidget {
  const AsyncStateView({
    super.key,
    required this.value,
    required this.data,
    this.onRetry,
    this.emptyMessage,
    this.loadingMessage,
    this.isEmpty,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;
  final String? emptyMessage;
  final String? loadingMessage;
  final bool Function(T data)? isEmpty;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: false,
      loading: () => LoadingView(message: loadingMessage),
      error: (error, _) =>
          ErrorView(message: error.toString(), onRetry: onRetry),
      data: (result) {
        final empty = isEmpty?.call(result) ?? false;
        if (empty) {
          return EmptyView(message: emptyMessage ?? context.l10n.noData);
        }
        return data(result);
      },
    );
  }
}
