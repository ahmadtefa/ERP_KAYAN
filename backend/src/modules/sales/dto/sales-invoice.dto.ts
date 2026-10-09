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

export class SalesInvoiceLineDto {
  @IsOptional() @IsUUID() itemId?: string;

  /// Optional: when an item is given the item's name is used instead, so a
  /// quick invoice does not force the user to retype what the item already says.
  @IsOptional() @IsString() @MaxLength(300) description?: string;

  /// Quantities and prices are strings so no binary floating-point rounding
  /// happens before the value reaches the server.
  @IsString() quantity!: string;
  @IsString() unitPrice!: string;

  /// Percent. When omitted the item's own rate is used.
  @IsOptional() @IsString() taxRate?: string;
}

export class CreateSalesInvoiceDto {
  @IsDateString() invoiceDate!: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsUUID() customerId!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

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
