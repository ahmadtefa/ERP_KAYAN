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
    this.hasAvatar = false,
    this.avatarUrl,
  });

  final String id;
  final String username;
  final String fullName;
  final String companyId;
  final String? branchId;
  final List<String> roles;
  final List<String> permissions;
  final bool isActive;

  /// Whether the account has a photo, and the API path that serves it.
  ///
  /// The path - not the image - is what a session carries: the picture is
  /// fetched once and cached by the client, so a person who changes it sees
  /// the new one everywhere without signing out. When [hasAvatar] is false the
  /// UI draws the person's initial instead; that is a normal state, not an
  /// error.
  final bool hasAvatar;
  final String? avatarUrl;

  /// Marks a session as having no picture, after one has been deleted.
  AppUser withoutAvatar() => AppUser(
    id: id,
    username: username,
    fullName: fullName,
    companyId: companyId,
    branchId: branchId,
    roles: roles,
    permissions: permissions,
    isActive: isActive,
    isSuperAdmin: isSuperAdmin,
  );

  /// The first letter of the name, for the placeholder.
  ///
  /// Takes the first *letter or digit* rather than the first code unit: a
  /// string starting with a space or a combining mark would otherwise draw an
  /// empty circle. The name is the person's, in whichever language it is
  /// stored.
  String get initial {
    for (final rune in fullName.runes) {
      final char = String.fromCharCode(rune);
      if (RegExp(r'[\p{L}\p{N}]', unicode: true).hasMatch(char)) {
        return char.toUpperCase();
      }
    }
    for (final rune in username.runes) {
      final char = String.fromCharCode(rune);
      if (RegExp(r'[\p{L}\p{N}]', unicode: true).hasMatch(char)) {
        return char.toUpperCase();
      }
    }
    return '?';
  }

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
