import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';

/// A small, calm status marker: posted, draft, overdue, active.
///
/// Colour carries meaning, but the label always says the same thing in words,
/// so the marker survives greyscale printing and colour-blind readers.
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    this.tone = AppTone.neutral,
    this.dot = true,
    this.dense = false,
  });

  final String label;
  final AppTone tone;
  final bool dot;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 6 : 8,
        vertical: dense ? 1 : 3,
      ),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(AppRadii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: tone.foreground,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: tone.foreground,
              fontWeight: FontWeight.w600,
              fontSize: dense ? 10.5 : 11,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }
}

/// Maps the server's document status strings to a tone without changing the
/// words the screens already show.
AppTone toneForStatus(String status) {
  return switch (status.trim().toLowerCase()) {
    'posted' || 'active' || 'accepted' || 'approved' || 'paid' => AppTone.success,
    'draft' || 'pending' || 'partial' || 'partially_paid' => AppTone.warning,
    'cancelled' ||
    'rejected' ||
    'inactive' ||
    'overdue' ||
    'expired' ||
    'reversed' => AppTone.danger,
    'sent' || 'converted' => AppTone.info,
    _ => AppTone.neutral,
  };
}
