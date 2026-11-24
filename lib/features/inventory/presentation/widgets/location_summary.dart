import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';

/// A split lot must not be labelled as if all of it were on one shelf.
String batchLocationSummary(Json row, {required bool arabic}) {
  final placed = listOf(row['locations']);
  if (placed.isNotEmpty) {
    final parts = [
      for (final location in placed)
        '${localizedRecordName(location, arabic: arabic).isEmpty ? text(location, 'code') : localizedRecordName(location, arabic: arabic)}: ${formatQuantity(asString(location['quantity']))}',
    ];
    final unknown = asNum(row['unplacedQuantity']) ?? 0;
    if (unknown != 0) {
      parts.add(
        '${arabic ? 'بدون موقع' : 'Unlocated'}: ${formatQuantity(asString(row['unplacedQuantity']))}',
      );
    }
    return parts.join(' | ');
  }
  final location = row['storageLocation'];
  if (location is Map) {
    final map = Map<String, dynamic>.from(location);
    return localizedRecordName(map, arabic: arabic).isEmpty
        ? text(map, 'code')
        : localizedRecordName(map, arabic: arabic);
  }
  return (asNum(row['unplacedQuantity']) ?? 0) != 0
      ? '${arabic ? 'بدون موقع' : 'Unlocated'}: ${formatQuantity(asString(row['unplacedQuantity']))}'
      : '—';
}
