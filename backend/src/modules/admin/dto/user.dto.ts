import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/// REQUIRES BUSINESS DECISION: the password policy below is a placeholder
/// chosen for safety, not a company rule. Length beats complexity, so the
/// requirement is twelve characters rather than a character-class mixture.
export class CreateUserDto {
  @IsString() @MaxLength(60) username!: string;
  @IsString() @MaxLength(200) fullNameEn!: string;
  @IsString() @MaxLength(200) fullNameAr!: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
  @IsOptional() @IsBoolean() isSuperAdmin?: boolean;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true })
  roleIds?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true })
  branchIds?: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(200) fullNameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) fullNameAr?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true })
  roleIds?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true })
  branchIds?: string[];
}

export class ChangePasswordDto {
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
}

export class ListUsersDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) includeInactive?: boolean;
}
