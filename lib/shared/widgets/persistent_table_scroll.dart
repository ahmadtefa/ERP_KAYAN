import 'package:flutter/material.dart';

/// Scrolls a wide, tall table in both directions with both scroll bars pinned
/// to the visible frame.
///
/// The sideways bar used to live inside the vertical scroll area, so on a long
/// list (hundreds of rows) it sat below the last row and the person could not
/// see that columns were hidden. Here both bars belong to the frame around the
/// scrollables: the horizontal one is always at the bottom of what is on
/// screen and the vertical one is always on the edge.
class PersistentTableScroll extends StatefulWidget {
  const PersistentTableScroll({super.key, required this.child});
  final Widget child;

  @override
  State<PersistentTableScroll> createState() => PersistentTableScrollState();
}

class PersistentTableScrollState extends State<PersistentTableScroll> {
  final ScrollController _horizontal = ScrollController();
  final ScrollController _vertical = ScrollController();

  @override
  void dispose() {
    _horizontal.dispose();
    _vertical.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Thin, low-contrast default bars are easy to miss on a dark surface, which
    // is how a hidden column went unnoticed. These are thick and clearly
    // lighter than the table behind them.
    final bars = ScrollbarThemeData(
      thickness: const WidgetStatePropertyAll(12),
      radius: const Radius.circular(6),
      thumbColor: WidgetStatePropertyAll(
        scheme.primary.withValues(alpha: 0.85),
      ),
      trackColor: WidgetStatePropertyAll(
        scheme.onSurface.withValues(alpha: 0.14),
      ),
      trackBorderColor: const WidgetStatePropertyAll(Colors.transparent),
      crossAxisMargin: 0,
    );
    return ScrollbarTheme(
      data: bars,
      child: Scrollbar(
        controller: _vertical,
        thumbVisibility: true,
        trackVisibility: true,
        notificationPredicate: (notification) =>
            notification.metrics.axis == Axis.vertical,
        child: Scrollbar(
          controller: _horizontal,
          thumbVisibility: true,
          trackVisibility: true,
          notificationPredicate: (notification) =>
              notification.metrics.axis == Axis.horizontal,
          child: SingleChildScrollView(
            controller: _horizontal,
            scrollDirection: Axis.horizontal,
            child: SingleChildScrollView(
              controller: _vertical,
              scrollDirection: Axis.vertical,
              child: widget.child,
            ),
          ),
        ),
      ),
    );
  }
}

/// A sideways scroller with a bar that is always visible, for a wide table
/// that does not scroll vertically itself (dialogs, previews). The plain
/// `SingleChildScrollView(scrollDirection: Axis.horizontal)` shows no bar at
/// all on desktop, so hidden columns were easy to miss.
class HorizontalScrollFrame extends StatefulWidget {
  const HorizontalScrollFrame({super.key, required this.child});
  final Widget child;

  @override
  State<HorizontalScrollFrame> createState() => _HorizontalScrollFrameState();
}

class _HorizontalScrollFrameState extends State<HorizontalScrollFrame> {
  final ScrollController _controller = ScrollController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scrollbar(
    controller: _controller,
    thumbVisibility: true,
    trackVisibility: true,
    notificationPredicate: (n) => n.metrics.axis == Axis.horizontal,
    child: SingleChildScrollView(
      controller: _controller,
      scrollDirection: Axis.horizontal,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: widget.child,
      ),
    ),
  );
}
