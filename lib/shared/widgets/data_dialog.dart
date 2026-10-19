import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../extensions/l10n_extension.dart';

/// A dialog built for data, not for a one-line question.
///
/// Data-heavy dialogs get a drag handle, a maximise button and a memory: the
/// size somebody chose is the size it opens at next time. Tiny confirmations
/// keep using [AlertDialog]; forcing a resize handle onto them would be noise.
///
/// The child keeps its state while the dialog is resized: only the frame is
/// rebuilt, so a half-typed line or a scrolled table is not thrown away.
Future<T?> showDataDialog<T>(
  BuildContext context, {
  required String storageKey,
  required Widget child,
  String? title,
  IconData? icon,
  Size initialSize = const Size(980, 640),
  Size minimumSize = const Size(420, 300),
}) {
  return showDialog<T>(
    context: context,
    barrierDismissible: false,
    builder: (context) => DataDialog<T>(
      storageKey: storageKey,
      title: title,
      icon: icon,
      initialSize: initialSize,
      minimumSize: minimumSize,
      child: child,
    ),
  );
}

class DataDialog<T> extends StatefulWidget {
  const DataDialog({
    super.key,
    required this.storageKey,
    required this.child,
    required this.initialSize,
    required this.minimumSize,
    this.title,
    this.icon,
  });

  final String storageKey;
  final Widget child;
  final Size initialSize;
  final Size minimumSize;
  final String? title;
  final IconData? icon;

  @override
  State<DataDialog<T>> createState() => _DataDialogState<T>();
}

class _DataDialogState<T> extends State<DataDialog<T>> {
  late double _width = widget.initialSize.width;
  late double _height = widget.initialSize.height;
  bool _maximised = false;
  bool _restored = false;

  String get _key => 'data-dialog.${widget.storageKey}';

  @override
  void initState() {
    super.initState();
    _restoreSize();
  }

  Future<void> _restoreSize() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key);
      if (!mounted || saved == null) return;
      final parts = saved.split('x');
      if (parts.length != 2) return;
      final width = double.tryParse(parts[0]);
      final height = double.tryParse(parts[1]);
      if (width == null || height == null) return;
      setState(() {
        _width = width;
        _height = height;
        _restored = true;
      });
    } catch (_) {
      // A dialog that cannot remember its size is still a working dialog.
    }
  }

  Future<void> _saveSize() async {
    if (_maximised) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, '${_width.round()}x${_height.round()}');
    } catch (_) {
      // Ignored on purpose: layout preference is not worth an error.
    }
  }

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final maxWidth = math.max(screen.width - 24, widget.minimumSize.width);
    final maxHeight = math.max(screen.height - 24, widget.minimumSize.height);
    final width = _maximised
        ? maxWidth
        : _width.clamp(widget.minimumSize.width, maxWidth).toDouble();
    final height = _maximised
        ? maxHeight
        : _height.clamp(widget.minimumSize.height, maxHeight).toDouble();

    return Dialog(
      insetPadding: const EdgeInsets.all(12),
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          children: [
            Column(
              children: [
                _DialogHeader(
                  title: widget.title,
                  icon: widget.icon,
                  maximised: _maximised,
                  canResize: screen.width > 700,
                  onToggleMaximise: () => setState(() {
                    _maximised = !_maximised;
                    _saveSize();
                  }),
                  onClose: () => Navigator.of(context).pop(),
                ),
                const Divider(height: 1),
                Expanded(child: widget.child),
              ],
            ),
            if (!_maximised)
              PositionedDirectional(
                end: 0,
                bottom: 0,
                child: MouseRegion(
                  cursor: SystemMouseCursors.resizeUpLeftDownRight,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onPanUpdate: (details) {
                      setState(() {
                        _width = (_width + details.delta.dx * (rtl ? -1 : 1))
                            .clamp(widget.minimumSize.width, maxWidth)
                            .toDouble();
                        _height = (_height + details.delta.dy)
                            .clamp(widget.minimumSize.height, maxHeight)
                            .toDouble();
                      });
                    },
                    onPanEnd: (_) => _saveSize(),
                    child: Tooltip(
                      message: context.l10n.resizeDialog,
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Icon(
                          Icons.open_in_full,
                          size: 15,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.45),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _DialogHeader extends StatelessWidget {
  const _DialogHeader({
    required this.maximised,
    required this.canResize,
    required this.onToggleMaximise,
    required this.onClose,
    this.title,
    this.icon,
  });

  final String? title;
  final IconData? icon;
  final bool maximised;
  final bool canResize;
  final VoidCallback onToggleMaximise;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 18, end: 6, top: 8, bottom: 8),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Text(
              title ?? '',
              style: theme.textTheme.titleMedium,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (canResize)
            IconButton(
              tooltip: maximised ? context.l10n.restore : context.l10n.maximize,
              onPressed: onToggleMaximise,
              icon: Icon(maximised ? Icons.close_fullscreen : Icons.open_in_full),
            ),
          IconButton(
            tooltip: context.l10n.close,
            onPressed: onClose,
            icon: const Icon(Icons.close),
          ),
        ],
      ),
    );
  }
}
