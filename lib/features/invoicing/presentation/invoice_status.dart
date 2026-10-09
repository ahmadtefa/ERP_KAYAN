import 'package:flutter/material.dart';

import '../../../core/json/json_utils.dart';
import '../../../shared/extensions/l10n_extension.dart';

/// Localised label for a document status.
///
/// The API sends statuses in lower case; the screen shows them in the
/// reader's language.
String statusLabel(BuildContext context, Json row) {
  final l10n = context.l10n;
  return switch (text(row, 'status').toLowerCase()) {
    'draft' => l10n.draft,
    'posted' => l10n.posted,
    'reversed' => l10n.reversed,
    _ => text(row, 'status'),
  };
}
