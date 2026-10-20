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

/// The cost-center report filters by hierarchy type and by one centre, so
/// those filters have to be declared here: the global validation pipe rejects
/// an undeclared query parameter instead of silently ignoring it.
export class CostCenterReportQueryDto extends PeriodQueryDto {
  /// DEPARTMENT, ADMINISTRATIVE_UNIT or PROJECT.
  @IsOptional() @IsString() type?: string;

  @IsOptional() @IsUUID() costCenterId?: string;

  /// Keep deactivated centres in the answer (they still hold history).
  @IsOptional() @IsString() includeInactive?: string;
}

/// The drill-down is paginated; both bounds are declared so a client can ask
/// for a smaller page without being refused.
export class CostCenterTransactionsQueryDto extends PeriodQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number;
}

/// Budget against actual. The range picks which budgets are listed; every row
/// compares its own budget period with the ledger, so the answer always says
/// which period it used.
export class BudgetReportQueryDto extends PeriodQueryDto {
  /// DEPARTMENT, ADMINISTRATIVE_UNIT or PROJECT.
  @IsOptional() @IsString() type?: string;

  @IsOptional() @IsUUID() costCenterId?: string;

  @IsOptional() @IsUUID() accountId?: string;

  /// Keep retired budgets in the answer.
  @IsOptional() @IsString() includeInactive?: string;
}
