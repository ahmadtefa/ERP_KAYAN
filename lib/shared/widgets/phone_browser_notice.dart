import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../extensions/l10n_extension.dart';

/// Says, once and plainly, that this is a desktop program opened on a phone.
///
/// The web build answers a phone because it is a page, not because the screens
/// were designed for one: an invoice line has eight fields, the records table
/// scrolls in both directions, and a report is a printed page. Opening those
/// on a 390-pixel-wide screen is not an error the program should hide, and it
/// is not a reason to refuse the sign-in either - the person may be checking a
/// balance on the way to the warehouse. So the warning is a banner: it says
/// what will not fit, tells them the way to get the full screen, and gets out
/// of the way for the rest of the session when they dismiss it.
///
/// It is deliberately absent from the desktop build and from a web build shown
/// on a real screen, so nothing changes for the people the program was made
/// for. [isWeb] is a parameter rather than a bare `kIsWeb` read so a widget
/// test can prove both answers without a browser.
class PhoneBrowserNotice extends StatefulWidget {
  const PhoneBrowserNotice({
    super.key,
    required this.child,
    this.isWeb = kIsWeb,
    this.breakpoint = 700,
  });

  /// What the program would have drawn had the window been a desktop one.
  final Widget child;

  /// Whether this build runs in a browser. Injecting it keeps the widget
  /// testable off the web.
  final bool isWeb;

  /// Logical width, in pixels, below which the window counts as a phone.
  final double breakpoint;

  @override
  State<PhoneBrowserNotice> createState() => _PhoneBrowserNoticeState();
}

class _PhoneBrowserNoticeState extends State<PhoneBrowserNotice> {
  /// Dismissed for this session only. A reload on a phone that cannot keep a
  /// sign-in is a fresh visit anyway, so the reminder coming back costs
  /// nothing; keeping it in storage would outlive its usefulness.
  bool _dismissed = false;

  @override
  Widget build(BuildContext context) {
    final isNarrow = MediaQuery.sizeOf(context).width < widget.breakpoint;
    if (!widget.isWeb || !isNarrow || _dismissed) return widget.child;

    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: scheme.secondaryContainer,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(16, 10, 8, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.phonelink_off_outlined,
                    size: 20,
                    color: scheme.onSecondaryContainer,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.phoneBrowserNoticeTitle,
                          style: Theme.of(context).textTheme.labelLarge
                              ?.copyWith(color: scheme.onSecondaryContainer),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          l10n.phoneBrowserNoticeBody,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: scheme.onSecondaryContainer),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => setState(() => _dismissed = true),
                    child: Text(l10n.phoneBrowserNoticeDismiss),
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(child: widget.child),
      ],
    );
  }
}
