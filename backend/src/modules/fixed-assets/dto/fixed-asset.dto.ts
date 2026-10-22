import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;

export class CreateFixedAssetDto {
  @IsOptional() @IsString() @MaxLength(50) @Matches(CODE_PATTERN)
  code?: string;

  @IsString() @MinLength(1) @MaxLength(200) nameEn!: string;
  @IsString() @MinLength(1) @MaxLength(200) nameAr!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;

  @IsDateString() purchaseDate!: string;
  @IsDateString() inServiceDate!: string;

  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() purchaseInvoiceId?: string;

  /// Money travels as strings, the way every amount in this API does, so a
  /// JSON number never gets to round an asset's cost.
  @IsString() @MaxLength(32) cost!: string;
  @IsOptional() @IsString() @MaxLength(32) salvageValue?: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(1200)
  usefulLifeMonths!: number;

  @IsUUID() assetAccountId!: string;
  @IsUUID() accumulatedAccountId!: string;
  @IsUUID() expenseAccountId!: string;
  @IsOptional() @IsUUID() costCenterId?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
}

export class UpdateFixedAssetDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsString() @MaxLength(60) category?: string | null;
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsDateString() inServiceDate?: string;
  @IsOptional() @IsUUID() supplierId?: string | null;
  @IsOptional() @IsUUID() purchaseInvoiceId?: string | null;
  @IsOptional() @IsString() @MaxLength(32) cost?: string;
  @IsOptional() @IsString() @MaxLength(32) salvageValue?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1200)
  usefulLifeMonths?: number;
  @IsOptional() @IsUUID() assetAccountId?: string;
  @IsOptional() @IsUUID() accumulatedAccountId?: string;
  @IsOptional() @IsUUID() expenseAccountId?: string;
  @IsOptional() @IsUUID() costCenterId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
}

export class ActivateFixedAssetDto {
  /// What paid for it: the supplier payable, a bank, a cash box. The
  /// activation entry is Dr asset / Cr this account.
  @IsUUID() fundingAccountId!: string;
  /// Defaults to the purchase date.
  @IsOptional() @IsDateString() date?: string;
}

export class DisposeFixedAssetDto {
  @IsDateString() date!: string;
  /// What the asset was sold for; "0" (or omitted) for a write-off.
  @IsOptional() @IsString() @MaxLength(32) proceeds?: string;
  /// Where the proceeds went. Required when there are any.
  @IsOptional() @IsUUID() proceedsAccountId?: string;
  /// Where the gain or loss lands. Defaults to the account map's
  /// disposal gain/loss accounts.
  @IsOptional() @IsUUID() gainLossAccountId?: string;
}

export class RunDepreciationDto {
  /// The calendar month to charge: "YYYY-MM".
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'period must be a month in the form YYYY-MM',
  })
  period!: string;

  /// Charge only these assets; omit for every eligible asset in the branch.
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  assetIds?: string[];
}

export class ListFixedAssetsDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
}

export class ListDepreciationRunsDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period?: string;
}
