import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/// The line fields an offer's table can show. Kept in one place so the client,
/// the print and the spreadsheet agree on what a column means.
export const QUOTATION_COLUMN_KEYS = [
  'itemCode',
  'description',
  'countryOfOrigin',
  'unit',
  'quantity',
  'unitPrice',
  'lineTotal',
] as const;

export class QuotationColumnDto {
  @IsIn(QUOTATION_COLUMN_KEYS as unknown as string[]) key!: string;

  /// A label this offer uses instead of the built-in one. Left empty means the
  /// translated standard label.
  @IsOptional() @IsString() @MaxLength(80) labelEn?: string;
  @IsOptional() @IsString() @MaxLength(80) labelAr?: string;

  /// Hidden columns are remembered but not printed, so a layout can be turned
  /// back on without rebuilding it.
  @IsOptional() @IsBoolean() visible?: boolean;

  /// Relative width in print. 1 is a narrow column, 4 a wide one.
  @IsOptional() @IsNumber() @Min(1) @Max(6) width?: number;
}

export class QuotationLineDto {
  /// Optional: a line may describe a service or a one-off that is not in the
  /// item list. When an item is named, its unit and origin are used as the
  /// defaults, and its name fills an empty description.
  @IsOptional() @IsUUID() itemId?: string;

  @IsOptional() @IsString() @MaxLength(500) description?: string;

  /// Where the goods were made. Copied from the item when the line names one,
  /// or typed. Never inferred.
  @IsOptional() @IsString() @MaxLength(80) countryOfOrigin?: string;

  @IsOptional() @IsString() @MaxLength(40) unit?: string;

  @IsString() quantity!: string;

  @IsOptional() @IsString() unitPrice?: string;
}

export class QuotationTableDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;

  @IsOptional() @IsIn(['PERCENT', 'AMOUNT']) discountType?: string;
  @IsOptional() @IsString() discountPercent?: string;
  @IsOptional() @IsString() discountAmount?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines!: QuotationLineDto[];
}

export class CreateQuotationDto {
  @IsDateString() quotationDate!: string;

  /// The day the offer stops being valid. Optional: an offer without one
  /// never expires by itself.
  @IsOptional() @IsDateString() validUntil?: string;

  @IsUUID() customerId!: string;

  @IsOptional() @IsString() @MaxLength(3) currency?: string;

  /// Terms and conditions, printed on the first page. Empty means the section
  /// is left out entirely rather than printed as a blank heading.
  @IsOptional() @IsString() @MaxLength(8000) terms?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;

  /// A discount on the whole offer, applied after the per-table discounts.
  @IsOptional() @IsIn(['PERCENT', 'AMOUNT']) discountType?: string;
  @IsOptional() @IsString() discountPercent?: string;
  @IsOptional() @IsString() discountAmount?: string;

  /// Signatories. When omitted, the company profile's values are used.
  @IsOptional() @IsString() @MaxLength(160) managerName?: string;
  @IsOptional() @IsString() @MaxLength(160) responsibleName?: string;
  @IsOptional() @IsString() @MaxLength(60) responsiblePhone?: string;

  /// The offer's own headline. Optional; it is not inferred from anything.
  @IsOptional() @IsString() @MaxLength(200) subject?: string;

  /// Whether this offer prints the company tax registration number. Omitted
  /// means the company default, so existing clients keep their behaviour.
  @IsOptional() @IsBoolean() showTaxId?: boolean;

  /// The line columns this offer prints, in order. Omitted means the standard
  /// set; an empty list is refused because an offer with no columns is not a
  /// readable document.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => QuotationColumnDto)
  columns?: QuotationColumnDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuotationTableDto)
  tables!: QuotationTableDto[];
}

export class UpdateQuotationDto extends CreateQuotationDto {}

export class ListQuotationsDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) page?: number = 1;
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number) pageSize?: number = 50;
}

export class QuotationNoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class QuotationColumnTemplateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => QuotationColumnDto)
  columns!: QuotationColumnDto[];

  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateQuotationColumnTemplateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => QuotationColumnDto)
  columns?: QuotationColumnDto[];

  @IsOptional() @IsBoolean() isDefault?: boolean;
}
