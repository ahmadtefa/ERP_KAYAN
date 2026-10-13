import 'dart:typed_data';

/// Everything the first-run setup collects on one screen.
///
/// Plain data with no dependencies, so the shell that starts the server and
/// the form that collects the values can both use it — and so can tests.
class CompanySetupData {
  const CompanySetupData({
    required this.companyCode,
    required this.companyNameAr,
    required this.companyNameEn,
    this.facilityKind = 'HEADQUARTERS',
    this.phone,
    this.email,
    this.address,
    this.hqCode,
    this.hqNameAr,
    this.hqNameEn,
    this.logoBytes,
    this.logoMime,
    required this.adminUsername,
    required this.adminPassword,
  });

  final String companyCode;
  final String companyNameAr;
  final String companyNameEn;
  final String facilityKind;
  final String? phone;
  final String? email;
  final String? address;

  /// The initial unit (headquarters or branch). Left empty, defaults are used.
  final String? hqCode;
  final String? hqNameAr;
  final String? hqNameEn;

  /// The optional logo, as the bytes of a real PNG/JPEG/WebP image. The
  /// server-side rules (magic numbers, 2 MB) apply to it exactly as they do
  /// to the logo endpoint.
  final Uint8List? logoBytes;
  final String? logoMime;

  final String adminUsername;
  final String adminPassword;

  /// What travels to the seed through the environment. The logo is a file
  /// instead (images do not belong in environment variables); see
  /// `KAYAN_COMPANY_LOGO_FILE`.
  Map<String, String> get environment => {
    'KAYAN_COMPANY_CODE': companyCode,
    'KAYAN_COMPANY_NAME_AR': companyNameAr,
    'KAYAN_COMPANY_NAME_EN': companyNameEn,
    'KAYAN_FACILITY_KIND': facilityKind,
    if (phone != null && phone!.isNotEmpty) 'KAYAN_COMPANY_PHONE': phone!,
    if (email != null && email!.isNotEmpty) 'KAYAN_COMPANY_EMAIL': email!,
    if (address != null && address!.isNotEmpty)
      'KAYAN_COMPANY_ADDRESS': address!,
    if (hqCode != null && hqCode!.isNotEmpty) 'KAYAN_HQ_CODE': hqCode!,
    if (hqNameAr != null && hqNameAr!.isNotEmpty)
      'KAYAN_HQ_NAME_AR': hqNameAr!,
    if (hqNameEn != null && hqNameEn!.isNotEmpty)
      'KAYAN_HQ_NAME_EN': hqNameEn!,
  };
}
