import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateItemDto {
  @IsString() @MaxLength(30) code!: string;
  @IsString() @MaxLength(200) nameEn!: string;
  @IsString() @MaxLength(200) nameAr!: string;

  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string;

  /// Amounts travel as strings so no precision is lost before the database.
  @IsOptional() @IsString() salePrice?: string;

  /// Percent, e.g. "14" for 14%.
  /// REQUIRES BUSINESS DECISION: the statutory rate.
  @IsOptional() @IsString() taxRate?: string;

  @IsOptional() @IsBoolean() isStockTracked?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateItemDto {
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string;
  @IsOptional() @IsString() salePrice?: string;
  @IsOptional() @IsString() taxRate?: string;
  @IsOptional() @IsBoolean() isStockTracked?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ListItemsDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) includeInactive?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) page?: number = 1;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) pageSize?: number = 50;
}
