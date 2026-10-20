/// Resolves the relative mark URL the API returns (`/companies/logo/:id`)
/// against the address the client actually talks to.
///
/// The server deliberately returns a path, not an absolute address: the same
/// installation is reached through localhost, a LAN address or a domain, and
/// only the running client knows which. A URL that already carries a scheme
/// is returned unchanged, so a proxy or a CDN can be used without a code
/// change.
String? resolveCompanyLogoUrl(String apiBaseUrl, Object? raw) {
  final value = raw?.toString().trim() ?? '';
  if (value.isEmpty) return null;

  final uri = Uri.tryParse(value);
  if (uri == null) return null;
  if (uri.hasScheme) return uri.toString();

  final base = Uri.tryParse(apiBaseUrl);
  if (base == null || !base.hasScheme || base.host.isEmpty) return value;

  final origin = Uri(
    scheme: base.scheme,
    host: base.host,
    port: base.hasPort ? base.port : null,
  );
  return origin.resolve(value.startsWith('/') ? value : '/$value').toString();
}
