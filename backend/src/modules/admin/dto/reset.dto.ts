import { IsString, MaxLength, MinLength } from 'class-validator';

/// The confirmation the screen makes the administrator type.
///
/// It is checked on the server as well as in the dialog: a client-side check
/// is a convenience, not a gate.
export const RESET_CONFIRMATION_WORD = 'RESET';

export class ResetCompanyDataDto {
  /// The administrator's own password, verified against the stored Argon2id
  /// hash. Never logged, never echoed back, never stored.
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /// Must be exactly `RESET`. The screen asks for it in a second, separate
  /// dialog after the warning.
  @IsString()
  @MaxLength(32)
  confirmation!: string;
}
