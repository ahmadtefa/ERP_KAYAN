import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PurchaseInvoiceLineDto {
  /// Purchases post into stock, so the item is required. Service purchases
  /// that do not touch stock belong in a journal entry instead.
  /// REQUIRES BUSINESS DECISION: whether service bills should be supported here.
  @IsUUID() itemId!: string;

  @IsOptional() @IsString() @MaxLength(300) description?: string;

  @IsString() quantity!: string;

  /// When omitted, the supplier's price list (or the item's own purchase
  /// price) decides.
  @IsOptional() @IsString() unitPrice?: string;

  @IsOptional() @IsString() taxRate?: string;

  /// The department, administrative unit or project the cost was incurred for.
  @IsOptional() @IsUUID() costCenterId?: string;
}

export class PurchaseLandedCostChargeDto {
  @IsString() @MinLength(1) @MaxLength(120) description!: string;
  @IsString() amount!: string;
}

export class CreatePurchaseInvoiceDto {
  @IsDateString() invoiceDate!: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsString() @MaxLength(60) supplierReference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /// Named freight, shipping, duties, and other acquisition costs. Each charge
  /// is retained for editing and reporting; their sum is allocated across
  /// stock lines in exact proportion to line value.
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true })
  @Type(() => PurchaseLandedCostChargeDto)
  landedCostCharges?: PurchaseLandedCostChargeDto[];

  /// Legacy aggregate accepted for older clients. When both fields are sent,
  /// it must equal the sum of `landedCostCharges`.
  @IsOptional() @IsString() landedCostAmount?: string;

  /// The warehouse the goods arrive in. Omit to use the branch's default.
  @IsOptional() @IsUUID() warehouseId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseInvoiceLineDto)
  lines!: PurchaseInvoiceLineDto[];
}

export class ListPurchaseInvoicesDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) page?: number = 1;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) pageSize?: number = 50;
}
