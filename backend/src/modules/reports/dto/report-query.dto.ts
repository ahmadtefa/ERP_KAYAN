import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class PeriodQueryDto {
  /// Inclusive. Defaults to the start of the current year.
  @IsOptional() @IsDateString() from?: string;

  /// Inclusive. Defaults to today.
  @IsOptional() @IsDateString() to?: string;

  @IsOptional() @IsUUID() branchId?: string;

  /// Used by the balance reports, which are read as at a single date rather
  /// than over a range.
  @IsOptional() @IsDateString() asOf?: string;
}
