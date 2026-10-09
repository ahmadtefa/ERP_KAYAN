import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';

/// The people who may sign in to this company.
class UsersController extends JsonListController {
  @override
  String get resourcePath => '/admin/users';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

final usersListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(UsersController.new);

/// The roles, each a named bundle of permissions.
class RolesController extends JsonListController {
  @override
  String get resourcePath => '/admin/roles';
}

final rolesListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(RolesController.new);

/// Every permission the server knows about, with the modules it belongs to.
///
/// The catalogue comes from the server rather than a hard-coded list here, so
/// a permission added on the server appears in the roles screen by itself.
final permissionsProvider = FutureProvider<Json>((ref) async {
  return ref.read(apiClientProvider).getObject('/admin/permissions');
});
