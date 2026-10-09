/// The authenticated principal.
///
/// Permissions are carried as opaque strings (e.g. `sales.invoice.create`)
/// and are treated as UI hints only — the server remains the authority.
class AppUser {
  const AppUser({
    required this.id,
    required this.username,
    required this.fullName,
    required this.companyId,
    this.branchId,
    this.roles = const [],
    this.permissions = const [],
    this.isActive = true,
  });

  final String id;
  final String username;
  final String fullName;
  final String companyId;
  final String? branchId;
  final List<String> roles;
  final List<String> permissions;
  final bool isActive;

  bool can(String permission) => permissions.contains(permission);

  bool hasRole(String role) => roles.contains(role);

  @override
  String toString() => 'AppUser($username, company: $companyId)';
}
