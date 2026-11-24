import { IsString, MaxLength, MinLength } from 'class-validator';

/// The written reason for one credit exception. The database also refuses a
/// reason shorter than 3 characters after trimming.
export class CreditApprovalDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
