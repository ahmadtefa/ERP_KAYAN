import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseInvoiceLineDto {
  /// Purchases post into stock, so the item is required. Service purchases
  /// that do not touch stock belong in a journal entry instead.
  /// REQUIRES BUSINESS DECISION: whether service bills should be supported here.
  @IsUUID() itemId!: string;

  @IsOptional() @IsString() @MaxLength(300) description?: string;

  @IsString() quantity!: string;
  @IsString() unitPrice!: string;

  @IsOptional() @IsString() taxRate?: string;
}

export class CreatePurchaseInvoiceDto {
  @IsDateString() invoiceDate!: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsString() @MaxLength(60) supplierReference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

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
