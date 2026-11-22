import { IsString, MaxLength, MinLength } from 'class-validator';

/** Public self-service password update; all failures share the same server response. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companyCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  // Match the established user-creation policy.
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  confirmPassword!: string;
}
