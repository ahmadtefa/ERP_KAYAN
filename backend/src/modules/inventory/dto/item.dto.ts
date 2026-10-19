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

  /// What the item costs to buy. It is the default on a purchase line, so a
  /// buyer does not retype last month's price, and it is what the reorder
  /// report prices a suggested order at.
  @IsOptional() @IsString() purchasePrice?: string;

  /// At or below this quantity the item needs reordering. 0 means "not
  /// watched", which is different from "order when stock runs out".
  @IsOptional() @IsString() reorderLevel?: string;

  @IsOptional() @IsString() categoryId?: string;

  /// Percent, e.g. "14" for 14%.
  /// REQUIRES BUSINESS DECISION: the statutory rate.
  @IsOptional() @IsString() taxRate?: string;

  @IsOptional() @IsBoolean() isStockTracked?: boolean;
  /// Where the item was made, printed on quotations. Optional: the program
  /// never guesses a country.
  @IsOptional() @IsString() @MaxLength(80) countryOfOrigin?: string;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /// Opening stock for a newly created item. Both must be given together;
  /// the pair posts inventory / opening equity and writes the stock movement,
  /// so the item is visible in the stock screen immediately. Entering opening
  /// stock here is refused once the branch has an opening-balance document -
  /// then the item belongs in that document instead.
  @IsOptional() @IsString() openingQuantity?: string;
  @IsOptional() @IsString() openingUnitCost?: string;
}

export class UpdateItemDto {
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string;
  @IsOptional() @IsString() salePrice?: string;
  @IsOptional() @IsString() purchasePrice?: string;
  @IsOptional() @IsString() reorderLevel?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() taxRate?: string;
  @IsOptional() @IsBoolean() isStockTracked?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(80) countryOfOrigin?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ListItemsDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) includeInactive?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) page?: number = 1;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) pageSize?: number = 50;
}
