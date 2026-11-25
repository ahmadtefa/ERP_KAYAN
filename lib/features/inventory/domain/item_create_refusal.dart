import '../../../core/error/failure.dart';

/// Refusals the server throws for "create item" BEFORE anything is written,
/// or inside the single database transaction that creates the item, its unit
/// rows and its opening stock, so the whole save is rolled back
/// (backend items.service.ts `create`: checks, then one `$transaction`).
///
/// Only a structured server refusal (HTTP 400, 403 or 409) whose sentence is one of
/// these exact rules counts. Everything else keeps the "may have completed"
/// lock that stops a duplicate save: network errors and timeouts, 5xx, a 503
/// "rolled back after taking too long", an unknown 400, a refusal wrapped in
/// anything but an [ApiFailure], and the same sentence on another status.
///
/// This is deliberately a list of known sentences, not "every 400".
final List<RegExp> _knownCreateRefusals = [
  RegExp(r'^code is required$', caseSensitive: false),
  RegExp(r'^Provide an Arabic or English item name$', caseSensitive: false),
  RegExp(r'^Item code \S+ is already used$', caseSensitive: false),
  RegExp(
    r'^Barcode \S+ is already assigned to item \S+$',
    caseSensitive: false,
  ),
  RegExp(
    r'^Barcode \S+ is already assigned to unit .+ of item \S+$',
    caseSensitive: false,
  ),
  RegExp(
    r'^Opening stock cannot be set on an item that is not stock-tracked$',
    caseSensitive: false,
  ),
  RegExp(
    r'^openingQuantity and openingUnitCost must be given together$',
    caseSensitive: false,
  ),
  RegExp(r'^openingQuantity must be greater than zero$', caseSensitive: false),
  RegExp(
    r'^Select a branch before adding opening stock$',
    caseSensitive: false,
  ),
  RegExp(
    r'^This branch already has an opening balance \(\S+\)\. Add the item there instead of giving it opening stock here\.$',
    caseSensitive: false,
  ),
  RegExp(
    r"^Required account \S+ \(\w+\) does not exist in this company's chart of accounts$",
    caseSensitive: false,
  ),
  RegExp(r'^Account \S+ cannot receive postings$', caseSensitive: false),
  RegExp(r'^Account \S+ is inactive$', caseSensitive: false),
  RegExp(
    r'^You may not receive stock into any active warehouse of your branch, so opening stock cannot be saved\.$',
    caseSensitive: false,
  ),
  RegExp(
    r'^All warehouses of this branch are inactive, so opening stock cannot be saved\. Activate a branch warehouse or save the item without opening stock\.$',
    caseSensitive: false,
  ),
  RegExp(
    r'^The opening stock warehouse changed since the form was opened\. Reopen the form to see the current warehouse\.$',
    caseSensitive: false,
  ),
  RegExp(
    r'^taxRate (cannot be negative|cannot exceed 100|is not a valid percentage)$',
    caseSensitive: false,
  ),
];

bool isKnownItemCreateRefusal(Object? error) {
  if (error is! ApiFailure) return false;
  final status = error.statusCode;
  if (status != 400 && status != 403 && status != 409) return false;
  final message = error.message.trim();
  return _knownCreateRefusals.any((rule) => rule.hasMatch(message));
}
