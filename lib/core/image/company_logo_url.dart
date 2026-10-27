/// Resolves the relative mark URL the API returns (`/companies/logo/:id`)
/// against the address the client actually talks to.
///
/// The server deliberately returns a path, not an absolute address: the same
/// installation is reached through localhost, a LAN address or a domain, and
/// only the running client knows which. A URL that already carries a scheme
/// is returned unchanged, so a proxy or a CDN can be used without a code
/// change.
///
/// The returned path is relative to the API root, and the API itself lives
/// under a prefix (`/api/v1`), so the path has to be joined onto the full
/// base address, prefix included. Resolving against the origin alone drops
/// the prefix; the request then misses every API route, the web app answers
/// with its own page, and the image fails to decode - which is why a saved
/// logo used to stay invisible everywhere it was shown.
String? resolveCompanyLogoUrl(String apiBaseUrl, Object? raw) {
  final value = raw?.toString().trim() ?? '';
  if (value.isEmpty) return null;

  final uri = Uri.tryParse(value);
  if (uri == null) return null;
  if (uri.hasScheme) return uri.toString();

  final base = Uri.tryParse(apiBaseUrl);
  if (base == null || !base.hasScheme || base.host.isEmpty) return value;

  var basePath = base.path;
  if (basePath.endsWith('/')) {
    basePath = basePath.substring(0, basePath.length - 1);
  }
  var path = uri.path.startsWith('/') ? uri.path : '/${uri.path}';
  // Join under the API prefix unless the address already carries it, so an
  // address that arrives complete is never prefixed twice.
  if (basePath.isNotEmpty &&
      path != basePath &&
      !path.startsWith('$basePath/')) {
    path = '$basePath$path';
  }
  return Uri(
    scheme: base.scheme,
    host: base.host,
    port: base.hasPort ? base.port : null,
    path: path,
    query: uri.hasQuery ? uri.query : null,
    fragment: uri.hasFragment ? uri.fragment : null,
  ).toString();
}

/// The mark for a company as an absolute address, from the two shapes the
/// API has used: the explicit `logoUrl` it returns today, or - for a payload
/// that only carries the flag and the id - the public endpoint itself.
String? companyLogoUrl(String apiBaseUrl, Map<String, dynamic> company) {
  final direct = resolveCompanyLogoUrl(apiBaseUrl, company['logoUrl']);
  if (direct != null) return direct;

  final id = company['id']?.toString().trim() ?? '';
  if (id.isEmpty || company['hasLogo'] != true) return null;
  return resolveCompanyLogoUrl(apiBaseUrl, '/companies/logo/$id');
}
