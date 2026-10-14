import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePartyDto {
  @IsString() @MaxLength(30) code!: string;
  @IsString() @MaxLength(200) nameEn!: string;
  @IsString() @MaxLength(200) nameAr!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /// Payment term in days: 0 means "due on the day of the invoice".
  @IsOptional() @IsInt() @Min(0) @Max(3650) @Type(() => Number) paymentTermDays?: number;
}

export class UpdatePartyDto {
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(3650) @Type(() => Number) paymentTermDays?: number;
}

export class CreateCustomerDto extends CreatePartyDto {
  /// Informational. REQUIRES BUSINESS DECISION: whether a sale may exceed it.
  @IsOptional() @IsString() creditLimit?: string;
}

export class UpdateCustomerDto extends UpdatePartyDto {
  @IsOptional() @IsString() creditLimit?: string;
}

export class ListPartiesDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) includeInactive?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) page?: number = 1;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) pageSize?: number = 50;
}
