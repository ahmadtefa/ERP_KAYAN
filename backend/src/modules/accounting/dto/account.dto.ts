import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;

export class CreateAccountDto {
  /// Left empty, the server suggests the next code under the chosen parent.
  @IsOptional() @IsString() @MaxLength(50) @Matches(CODE_PATTERN, {
    message: 'code must be 1-50 characters: letters, digits, dash, dot or underscore',
  })
  code?: string;

  @IsString() @MinLength(1) @MaxLength(200) nameEn!: string;
  @IsString() @MinLength(1) @MaxLength(200) nameAr!: string;

  /// Defaults to EXPENSE: the expense screen creates expense accounts without
  /// naming a type (the contract the desktop client has always used).
  @IsOptional() @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])
  type?: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

  @IsOptional() @IsString() @MaxLength(500) description?: string | null;

  @IsOptional() @IsUUID() parentId?: string;

  /// A grouping account collects its children and cannot receive postings;
  /// a final (postable) account is the one lines are written against.
  @IsOptional() @IsBoolean() isPostable?: boolean;

  @IsOptional() @IsString() @MaxLength(3) currency?: string;

  /// IAS 7 class for the cash-flow statement. Left unset, the account's
  /// cash movements report as unclassified rather than guessed.
  @IsOptional() @IsIn(['OPERATING', 'INVESTING', 'FINANCING'])
  cashFlowClass?: 'OPERATING' | 'INVESTING' | 'FINANCING';
}

export class UpdateAccountDto {
  /// The code only changes while the account has no movements — renumbering a
  /// account someone already posted against would rewrite history's labels.
  @IsOptional() @IsString() @MaxLength(50) @Matches(CODE_PATTERN)
  code?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nameAr?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsBoolean() isPostable?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(['OPERATING', 'INVESTING', 'FINANCING'])
  cashFlowClass?: 'OPERATING' | 'INVESTING' | 'FINANCING' | null;
}

export class ListAccountsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])
  type?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive?: boolean;
}
