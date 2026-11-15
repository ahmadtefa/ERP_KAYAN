import { Allow, IsIn, IsOptional } from 'class-validator';

/**
 * Query fields for barcode label print/PDF endpoints.
 *
 * `specs` repeats as `specs=unitId:copies` (a single occurrence arrives as a
 * string, several as an array). It is declared with `@Allow` so the global
 * `forbidNonWhitelisted` pipe does not reject it, while all real validation
 * stays in BarcodeLabelsService.parseSpecs.
 */
export class BarcodeLabelsQueryDto {
  @Allow()
  specs?: string[] | string;

  /** One-minute download ticket, consumed by JwtAuthGuard on print/PDF routes. */
  @Allow()
  ticket?: string;

  @IsOptional()
  @IsIn(['A4', 'THERMAL_80', 'THERMAL_58'])
  paper?: 'A4' | 'THERMAL_80' | 'THERMAL_58';

  @IsOptional()
  @IsIn(['true', 'false'])
  showPrice?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';

  @IsOptional()
  @IsIn(['1', 'true', '0', 'false'])
  auto?: string;
}
