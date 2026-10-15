import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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

/// The aging reports read one side of the book at a single date.
export class AgingQueryDto extends PeriodQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
}

/// Operational reports: documents filtered by party, account and status.
export class OperationsQueryDto extends PeriodQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() cashAccountId?: string;

  /// DRAFT, POSTED, REVERSED or ALL (default POSTED).
  @IsOptional() @IsString() status?: string;

  /// RECEIPT, PAYMENT or ALL for the payments report;
  /// sales or purchases for the outstanding-invoices report.
  @IsOptional() @IsString() kind?: string;

  /// How many months the monthly comparison covers (dashboard charts).
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) months?: number;
}
