import 'package:flutter/widgets.dart';

import '../../core/json/discount_math.dart';
import '../extensions/l10n_extension.dart';

/// The word a person reads for a discount kind, in their own language.
///
/// Kept in one place so the invoice editor and the quotation editor cannot
/// drift into calling the same choice by two different names.
String discountKindLabel(BuildContext context, DiscountKind kind) =>
    switch (kind) {
      DiscountKind.none => context.l10n.noDiscount,
      DiscountKind.percent => context.l10n.discountPercent,
      DiscountKind.amount => context.l10n.discountAmount,
    };
