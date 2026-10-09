import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateExpenseAccountDto {
  @IsString() @Matches(/\S/) @MaxLength(30) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) nameEn!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) nameAr!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsBoolean() isPostable?: boolean;
}

export class UpdateExpenseAccountDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(30) code?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(160) nameEn?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(160) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsBoolean() isPostable?: boolean;
}
