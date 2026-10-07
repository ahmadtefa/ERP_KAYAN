import '../../domain/entities/app_user.dart';

/// Request payload for `POST /auth/login`.
class LoginRequestDto {
  const LoginRequestDto({required this.username, required this.password});

  final String username;
  final String password;

  Map<String, dynamic> toJson() => {'username': username, 'password': password};
}

/// Token payload returned by the API.
///
/// Key names are resolved defensively so the client tolerates the common
/// snake_case/camelCase spellings used by different backend generators.
class TokenPairDto {
  const TokenPairDto({required this.accessToken, this.refreshToken});

  factory TokenPairDto.fromJson(Map<String, dynamic> json) {
    final access =
        (json['accessToken'] ?? json['access_token'] ?? json['token'])
            as String?;
    if (access == null || access.isEmpty) {
      throw const FormatException('Response did not contain an access token');
    }
    return TokenPairDto(
      accessToken: access,
      refreshToken: (json['refreshToken'] ?? json['refresh_token']) as String?,
    );
  }

  final String accessToken;
  final String? refreshToken;
}

/// Maps the API user representation onto the domain [AppUser].
class UserDto {
  const UserDto(this.json);

  final Map<String, dynamic> json;

  AppUser toDomain() {
    String? str(List<String> keys) {
      for (final key in keys) {
        final value = json[key];
        if (value is String && value.isNotEmpty) return value;
      }
      return null;
    }

    List<String> list(List<String> keys) {
      for (final key in keys) {
        final value = json[key];
        if (value is List) {
          return value.whereType<String>().toList(growable: false);
        }
      }
      return const [];
    }

    final id = str(['id', 'userId', 'user_id']);
    final username = str(['username', 'userName', 'login']);
    if (id == null || username == null) {
      throw const FormatException('User payload is missing id or username');
    }

    return AppUser(
      id: id,
      username: username,
      fullName: str(['fullName', 'full_name', 'name']) ?? username,
      companyId: str(['companyId', 'company_id']) ?? '',
      branchId: str(['branchId', 'branch_id']),
      roles: list(['roles']),
      permissions: list(['permissions']),
      isActive: json['isActive'] as bool? ?? json['is_active'] as bool? ?? true,
    );
  }
}
