import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/// Company profile and branch setup.
///
/// Codes follow the project's existing rules: short, uppercase-friendly
/// identifiers without spaces (the seeded company is `KAYAN`, branches `MAIN`).
/// Everything else is optional: a company can be recorded with its names and
/// code alone, and filled in later.

const CODE_PATTERN = /^[A-Za-z0-9_-]{2,20}$/;

export class UpdateCompanyProfileDto {
  @IsOptional() @IsString() @MaxLength(4) @Matches(CODE_PATTERN, {
    message: 'code must be 2-20 characters: letters, digits, dash or underscore',
  })
  code?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
}

export class CreateBranchDto {
  @IsString() @MaxLength(20) @Matches(CODE_PATTERN, {
    message: 'code must be 2-20 characters: letters, digits, dash or underscore',
  })
  code!: string;

  @IsString() @MinLength(1) @MaxLength(200) nameEn!: string;
  @IsString() @MinLength(1) @MaxLength(200) nameAr!: string;

  /// "HEADQUARTERS" or "BRANCH". A company may have exactly one headquarters.
  @IsOptional() @IsIn(['HEADQUARTERS', 'BRANCH'])
  kind?: 'HEADQUARTERS' | 'BRANCH';

  /// Required for a BRANCH unless the company already has a headquarters,
  /// which becomes the parent automatically.
  @IsOptional() @IsUUID() parentBranchId?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameAr?: string;
  @IsOptional() @IsIn(['HEADQUARTERS', 'BRANCH'])
  kind?: 'HEADQUARTERS' | 'BRANCH';
  @IsOptional() @IsUUID() parentBranchId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/// The first-run setup: company, its headquarters, and the first
/// administrator. All of it in one request, because a half-finished setup is
/// worse than none — the whole thing runs in one transaction.
export class InitialSetupDto {
  @IsString() @MaxLength(20) @Matches(CODE_PATTERN, {
    message: 'code must be 2-20 characters: letters, digits, dash or underscore',
  })
  companyCode!: string;

  @IsString() @MinLength(1) @MaxLength(200) companyNameAr!: string;
  @IsString() @MinLength(1) @MaxLength(200) companyNameEn!: string;

  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;

  @IsOptional() @IsString() @MaxLength(20) @Matches(CODE_PATTERN)
  hqCode?: string;
  @IsOptional() @IsString() @MaxLength(200) hqNameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) hqNameAr?: string;

  /// The optional logo, sent as base64 together with the setup so a new
  /// installation can come up complete in one request. Omit both and the
  /// system works exactly the same, without a logo.
  @IsOptional() @IsString() @MaxLength(4_000_000) logoBase64?: string;
  @IsOptional() @IsString() @MaxLength(64) logoMime?: string;

  @IsString() @MinLength(3) @MaxLength(60) adminUsername!: string;
  @IsString() @MinLength(12) @MaxLength(200) adminPassword!: string;
  @IsOptional() @IsString() @MaxLength(200) adminFullNameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) adminFullNameAr?: string;

  /// When the person running the setup already chose a password elsewhere
  /// (the desktop installer passes one through the environment), they may ask
  /// for the sample chart of accounts as well.
  @IsOptional() @Type(() => Boolean) seedChartOfAccounts?: boolean;
}
