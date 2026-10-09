import { IsEmail, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(160) nameEn?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(160) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(40) taxId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) commercialRegistration?: string | null;
  @IsOptional() @IsString() @MaxLength(500) addressEn?: string | null;
  @IsOptional() @IsString() @MaxLength(500) addressAr?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @ValidateIf((_object, value) => value != null && value !== '') @IsEmail() @MaxLength(254) email?: string | null;
  }

