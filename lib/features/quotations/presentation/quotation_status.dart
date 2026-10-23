import 'package:flutter/material.dart';

import '../../../core/json/json_utils.dart';
import '../../../shared/extensions/l10n_extension.dart';

/// The lifecycle word a person sees, in their own language.
String quotationStatusLabel(BuildContext context, String status) {
  final l10n = context.l10n;
  return switch (status.toLowerCase()) {
    'draft' => l10n.draft,
    'sent' => l10n.sent,
    'accepted' => l10n.accepted,
    'rejected' => l10n.rejected,
    'expired' => l10n.expired,
    'converted' => l10n.converted,
    _ => status,
  };
}

/// A colour that says the same thing as the word, and never on its own: the
/// status is always printed as text as well.
Color quotationStatusColor(BuildContext context, String status) {
  final scheme = Theme.of(context).colorScheme;
  return switch (status.toLowerCase()) {
    'accepted' => scheme.primary,
    'rejected' => scheme.error,
    'expired' => scheme.outline,
    'converted' => scheme.tertiary,
    'sent' => scheme.secondary,
    _ => scheme.onSurfaceVariant,
  };
}

/// Never invents a customer: an empty relation is shown as a dash.
String partyName(Object? raw, String language) {
  if (raw is! Map) return '—';
  final party = Map<String, dynamic>.from(raw);
  final name = language == 'ar' && text(party, 'nameAr').isNotEmpty
      ? text(party, 'nameAr')
      : text(party, 'nameEn');
  final code = text(party, 'code');
  if (code.isEmpty && name.isEmpty) return '—';
  return '$code — $name';
}
