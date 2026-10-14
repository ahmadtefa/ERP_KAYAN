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
    this.isSuperAdmin = false,
  });

  final String id;
  final String username;
  final String fullName;
  final String companyId;
  final String? branchId;
  final List<String> roles;
  final List<String> permissions;
  final bool isActive;

  /// Whether the server lets this account past the permission check without
  /// any permission at all. Shown to the client because it decides what to
  /// offer: a screen that hides an action the server would allow is as wrong
  /// as one that offers something the server will refuse.
  final bool isSuperAdmin;

  /// The server decides; this only keeps the screen from offering a button
  /// that would be refused the moment it was pressed.
  bool can(String permission) => isSuperAdmin || permissions.contains(permission);

  bool hasRole(String role) => roles.contains(role);

  @override
  String toString() => 'AppUser($username, company: $companyId)';
}
