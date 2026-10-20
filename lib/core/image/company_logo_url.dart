/// Resolves the mark URL the API returns against the address the client
/// actually talks to.
///
/// The server deliberately returns a path, not an absolute address: the same
/// installation is reached through localhost, a LAN address or a domain, and
/// only the running client knows which. The path is relative to the API root
/// (`/companies/logo/:id` under the server's `api/v1` prefix), so it is joined
/// to the *whole* base URL — including its path prefix. Resolving it against
/// the bare origin would drop `/api/v1` and fetch the web client's own page
/// instead of the image. A URL that already carries a scheme is returned
/// unchanged, so a proxy or a CDN can be used without a code change.
String? resolveCompanyLogoUrl(String apiBaseUrl, Object? raw) {
  final value = raw?.toString().trim() ?? '';
  if (value.isEmpty) return null;

  final uri = Uri.tryParse(value);
  if (uri == null) return null;
  if (uri.hasScheme) return uri.toString();

  final base = Uri.tryParse(apiBaseUrl);
  if (base == null || !base.hasScheme || base.host.isEmpty) return value;

  // The prefix the API is mounted under (`/api/v1`, or empty on a bare host).
  var prefix = base.path;
  if (prefix.endsWith('/')) {
    prefix = prefix.substring(0, prefix.length - 1);
  }

  // A path the server already prefixed (`/api/v1/...`) must not grow a second
  // copy of the prefix; anything else is relative to the API root.
  final incoming = uri.path;
  final alreadyPrefixed =
      prefix.isNotEmpty &&
      (incoming == prefix || incoming.startsWith('$prefix/'));
  final joined = alreadyPrefixed ? incoming : '$prefix$incoming';

  return Uri(
    scheme: base.scheme,
    host: base.host,
    port: base.hasPort ? base.port : null,
    path: joined.isEmpty ? '/' : joined,
    query: uri.hasQuery ? uri.query : null,
    fragment: uri.hasFragment ? uri.fragment : null,
  ).toString();
}

/// The mark for a company as an absolute address, from the shapes the API has
/// used: the explicit `logoUrl` it returns today (which carries its own
/// `?v=` cache-buster that changes whenever the logo changes), or — for a
/// payload that only carries the flag and the id — the public endpoint
/// itself, versioned from `updatedAt` when the payload reports one.
String? companyLogoUrl(String apiBaseUrl, Map<String, dynamic> company) {
  final direct = resolveCompanyLogoUrl(apiBaseUrl, company['logoUrl']);
  if (direct != null) return direct;

  final id = company['id']?.toString().trim() ?? '';
  if (id.isEmpty || company['hasLogo'] != true) return null;
  final version = company['updatedAt']?.toString().trim() ?? '';
  final suffix = version.isEmpty ? '' : '?v=$version';
  return resolveCompanyLogoUrl(apiBaseUrl, '/companies/logo/$id$suffix');
}
