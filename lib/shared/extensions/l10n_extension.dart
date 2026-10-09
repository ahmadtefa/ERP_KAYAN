import 'package:flutter/widgets.dart';

import '../../l10n/generated/app_localizations.dart';

/// Ergonomic access to the generated localizations.
extension LocalizationX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}
