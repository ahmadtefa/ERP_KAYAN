import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  /// The company the person works for. Required once the installation holds
  /// more than one company, because the same username can exist in each.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  companyCode?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}
