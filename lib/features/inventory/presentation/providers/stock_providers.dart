import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';

import '../../../common/presentation/providers/resource_providers.dart';

class StockController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock';
}

/// Shared by the balance screen and every operation that changes stock.
final stockListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(StockController.new);
