import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { PeriodStatus } from '@prisma/client';

export class CreateFiscalPeriodDto {
  @IsString() @MaxLength(20) code!: string;
  @IsString() @MaxLength(200) nameEn!: string;
  @IsString() @MaxLength(200) nameAr!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

export class UpdateFiscalPeriodDto {
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class ListFiscalPeriodsDto {
  @IsOptional() @IsEnum(PeriodStatus) status?: PeriodStatus;
  @IsOptional() @IsNumber() @Min(2000) @Type(() => Number) year?: number;
}
