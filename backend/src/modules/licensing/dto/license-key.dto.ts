import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LicenseKeyDto {
  /**
   * The key as the customer received it. Whitespace is removed before it is
   * read, because a key copied out of WhatsApp arrives wrapped across lines.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  key!: string;
}
