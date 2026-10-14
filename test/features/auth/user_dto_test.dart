import 'package:flutter_test/flutter_test.dart';

import 'package:erp_kayan/features/auth/data/models/auth_dtos.dart';

void main() {
  group('UserDto', () {
    Map<String, dynamic> userJson({bool isSuperAdmin = false}) => {
      'id': 'user-1',
      'username': 'admin',
      'fullName': 'ERP Admin',
      'companyId': 'company-1',
      'permissions': <String>[],
      'isSuperAdmin': isSuperAdmin,
    };

    test('maps super-administrator status from the current-user response', () {
      final user = UserDto(userJson(isSuperAdmin: true)).toDomain();

      expect(user.isSuperAdmin, isTrue);
      expect(user.can('admin.company.manage'), isTrue);
    });

    test('keeps ordinary users from gaining super-administrator access', () {
      final user = UserDto(userJson()).toDomain();

      expect(user.isSuperAdmin, isFalse);
      expect(user.can('admin.company.manage'), isFalse);
    });

    test('accepts the snake_case API spelling', () {
      final json = userJson()..remove('isSuperAdmin');
      json['is_super_admin'] = true;
      final user = UserDto(json).toDomain();

      expect(user.isSuperAdmin, isTrue);
    });
  });
}
