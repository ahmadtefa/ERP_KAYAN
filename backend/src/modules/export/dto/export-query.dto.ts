import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

import { PeriodQueryDto } from '../../reports/dto/report-query.dto';

/// The query string of a download or a print page.
///
/// Every field the two routes accept is declared here on purpose. A parameter
/// typed as a plain intersection would arrive as `Object` and skip validation
/// altogether, so a nonsense account id would reach the report builder and
/// come back as an unexplained failure instead of a clear message.
export class ExportQueryDto extends PeriodQueryDto {
  /// xlsx by default; csv for a plain text file.
  @IsOptional() @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv';

  /// Which language the file is written in. Defaults to English.
  @IsOptional() @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';

  /// The account the ledger is asked for. Only the ledger uses it.
  @IsOptional() @IsUUID()
  accountId?: string;

  /// Open the browser's print dialogue as soon as the page loads.
  @IsOptional() @IsIn(['1', '0'])
  auto?: string;

  /// The access token, in the query string.
  ///
  /// A print page is opened as a navigation - the browser cannot attach an
  /// Authorization header to it - so the token has to be able to travel in the
  /// URL. It is declared here because the route validates its query strictly:
  /// an undeclared property would be refused with "property token should not
  /// exist" instead of reaching the guard. Only routes marked
  /// @AllowQueryToken() ever look at it.
  @IsOptional() @IsString()
  token?: string;
}
