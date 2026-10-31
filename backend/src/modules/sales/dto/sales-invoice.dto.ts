import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SalesInvoiceLineDto {
  @IsOptional() @IsUUID() itemId?: string;

  /// Optional: when an item is given the item's name is used instead, so a
  /// quick invoice does not force the user to retype what the item already says.
  @IsOptional() @IsString() @MaxLength(300) description?: string;

  /// Quantities and prices are strings so no binary floating-point rounding
  /// happens before the value reaches the server. This is the quantity in the
  /// CHOSEN unit (e.g. 1 carton); the server converts it to the base unit for
  /// stock using the item's factor.
  @IsString() quantity!: string;

  /// The unit the quantity is expressed in. Omit for legacy/base-unit lines.
  /// Either the ItemUnit id or its label may be sent; the resolved factor and
  /// label are frozen onto the document.
  @IsOptional() @IsString() @MaxLength(40) unitName?: string;
  @IsOptional() @IsUUID() unitId?: string;

  /// When omitted, the customer's price list (or the item's own price)
  /// decides, so the same list is not retyped on every invoice.
  @IsOptional() @IsString() unitPrice?: string;

  /// Percent. When omitted the item's own rate is used.
  @IsOptional() @IsString() taxRate?: string;

  /// The department, administrative unit or project this revenue belongs to.
  /// Optional: an invoice that does not need cost analysis stays as it was.
  @IsOptional() @IsUUID() costCenterId?: string;

  /// PERCENT or AMOUNT. When omitted, a percent is assumed if one is given,
  /// which is the shape older clients send.
  @IsOptional() @IsIn(['PERCENT', 'AMOUNT']) discountType?: string;

  /// The line discount. Percent is 0-100; amount is money and may not exceed
  /// the line value. The server resolves the other representation itself.
  @IsOptional() @IsString() discountPercent?: string;
  @IsOptional() @IsString() discountAmount?: string;
}

export class CreateSalesInvoiceDto {
  @IsDateString() invoiceDate!: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsUUID() customerId!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /// The warehouse the goods leave. Omit to use the branch's default.
  @IsOptional() @IsUUID() warehouseId?: string;

  /// A discount on the document as a whole, applied before tax and allocated
  /// across the lines in exact proportion to their net value.
  @IsOptional() @IsIn(['PERCENT', 'AMOUNT']) discountType?: string;
  @IsOptional() @IsString() discountPercent?: string;
  @IsOptional() @IsString() discountAmount?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceLineDto)
  lines!: SalesInvoiceLineDto[];
}

export class ListInvoicesDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) page?: number = 1;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) pageSize?: number = 50;
}
