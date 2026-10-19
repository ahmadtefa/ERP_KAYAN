import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  MinLength,
  ValidateNested,
} from 'class-validator';

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
