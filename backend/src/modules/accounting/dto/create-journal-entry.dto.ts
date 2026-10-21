import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class JournalLineAllocationDto {
  @IsUUID()
  costCenterId!: string;

  /// A positive amount, as a string, at most four decimal places. The service
  /// checks that the allocations of a line add up to the line amount exactly.
  @IsString()
  amount!: string;
}

export class JournalLineDto {
  @IsUUID()
  accountId!: string;

  /// Amounts are strings to avoid binary floating-point rounding before the
  /// value ever reaches the database.
  @IsOptional()
  @IsString()
  debit?: string;

  @IsOptional()
  @IsString()
  credit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /// One centre for the whole line, or `allocations` for a controlled split.
  /// The service refuses a line that sends both.
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineAllocationDto)
  allocations?: JournalLineAllocationDto[];
}

export class CreateJournalEntryDto {
  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class ListJournalEntriesDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 50;
}
