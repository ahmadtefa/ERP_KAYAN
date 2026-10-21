import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/// One saved set of terms and conditions.
///
/// The library is a convenience only: choosing an entry copies its text into
/// the quotation being edited, so a later edit of the saved entry (or of
/// another quotation) never changes a document that has already been printed.
export class CreateQuotationTermDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;

  @IsString() @MinLength(1) @MaxLength(8000) body!: string;

  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

export class UpdateQuotationTermDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) body?: string;

  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;

  @IsOptional() @IsBoolean() isActive?: boolean;
}
