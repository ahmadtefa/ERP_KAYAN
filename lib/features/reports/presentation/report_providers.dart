import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/json/json_utils.dart';
import '../../auth/presentation/providers/auth_providers.dart';

/// Cached by endpoint and filters. Financial mutations invalidate the whole
/// family, including previously visited reports that are not currently visible.
final reportProvider = FutureProvider.family<Json, String>((ref, path) async {
  return ref.read(apiClientProvider).getObject(path);
});
