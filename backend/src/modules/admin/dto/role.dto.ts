import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString() @MaxLength(40) code!: string;
  @IsString() @MaxLength(200) nameEn!: string;
  @IsString() @MaxLength(200) nameAr!: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions?: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string;
}

export class SetRolePermissionsDto {
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions!: string[];
}

export class AssignRoleDto {
  @IsUUID() userId!: string;
}
