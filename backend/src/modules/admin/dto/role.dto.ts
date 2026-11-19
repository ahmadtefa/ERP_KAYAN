import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateRoleDto {
  @IsString() @MaxLength(40) code!: string;
  @IsString() @MaxLength(200) nameEn!: string;
  @IsString() @MaxLength(200) nameAr!: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionEn?: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionAr?: string;
  @IsOptional() @IsString() @MaxLength(20) category?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions?: string[];
  /// Start from another role instead of an empty list: the roles screen's
  /// "copy" button. The copy is never a system role and never inherits the
  /// original's users.
  @IsOptional() @IsUUID('4') copyFromRoleId?: string;
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionEn?: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionAr?: string;
  @IsOptional() @IsString() @MaxLength(20) category?: string;
  /// Disabling a role keeps its holders and its history but stops it granting
  /// anything; enabling it puts it back exactly as it was.
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/// What the roles screen shows before saving: how many permissions the set
/// contains, which modules they touch, and what deserves a second look.
export class PreviewRolePermissionsDto {
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions!: string[];
}

export class SetRolePermissionsDto {
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions!: string[];
  /// A client may supply the set it read to reject a stale replacement.
  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayUnique() @IsString({ each: true })
  @MaxLength(120, { each: true })
  expectedPermissions?: string[];
}

export class AssignRoleDto {
  @IsUUID() userId!: string;
}
