import '../../../core/network/api_client.dart';

/// The licence, as the server sees it.
///
/// The server is the authority; this class only carries what the screens show.
/// Every field is read defensively: an older server that does not send a field
/// must not crash the licence screen, because that screen is the way to fix a
/// licence problem.
class LicenceStatus {
  const LicenceStatus({
    required this.state,
    required this.blocked,
    required this.enforcement,
    required this.configured,
    required this.perpetual,
    required this.machineId,
    required this.installId,
    required this.requestCode,
    required this.clockState,
    required this.seatLimit,
    required this.seatsUsed,
    this.licenseId,
    this.expiresAt,
    this.issuedAt,
    this.startsAt,
    this.daysRemaining,
    this.availableSeats,
    this.publicKeyFingerprint,
    this.clockNote,
    this.expiringSoon = false,
  });

  factory LicenceStatus.fromJson(Map<String, dynamic> json) {
    final seats = json['seats'];
    final seatMap = seats is Map
        ? Map<String, dynamic>.from(seats)
        : const <String, dynamic>{};
    final clock = json['clock'];
    final clockMap = clock is Map
        ? Map<String, dynamic>.from(clock)
        : const <String, dynamic>{};
    return LicenceStatus(
      state: '${json['state'] ?? 'UNLICENSED'}',
      blocked: json['blocked'] == true,
      enforcement: '${json['enforcement'] ?? 'warn'}',
      configured: json['configured'] == true,
      perpetual: json['perpetual'] == true,
      machineId: '${json['machineId'] ?? ''}',
      installId: '${json['installId'] ?? ''}',
      requestCode: '${json['requestCode'] ?? ''}',
      clockState: '${clockMap['state'] ?? 'OK'}',
      seatLimit: _int(seatMap['limit']),
      seatsUsed: _int(seatMap['used']),
      availableSeats: seatMap['available'] == null
          ? null
          : _int(seatMap['available']),
      licenseId: json['licenseId'] as String?,
      expiresAt: _date(json['expiresAt']),
      issuedAt: _date(json['issuedAt']),
      startsAt: _date(json['startsAt']),
      daysRemaining: json['daysRemaining'] == null
          ? null
          : _int(json['daysRemaining']),
      publicKeyFingerprint: json['publicKeyFingerprint'] as String?,
      clockNote: clockMap['note'] as String?,
      expiringSoon: json['expiringSoon'] == true,
    );
  }

  /// UNLICENSED, ACTIVE, EXPIRED or SUSPENDED.
  final String state;

  /// True only when the licence policy is enforced and this installation may
  /// not be used for business.
  final bool blocked;

  /// off, warn or enforce.
  final String enforcement;

  /// Whether a public key is installed, i.e. whether any key can be checked.
  final bool configured;

  /// A perpetual licence has no end date and is never expired.
  final bool perpetual;

  final String machineId;
  final String installId;
  final String requestCode;
  final String clockState;

  final int seatLimit;
  final int seatsUsed;
  final int? availableSeats;

  final String? licenseId;
  final DateTime? expiresAt;
  final DateTime? issuedAt;
  final DateTime? startsAt;
  final int? daysRemaining;
  final String? publicKeyFingerprint;
  final String? clockNote;
  final bool expiringSoon;

  bool get isActive => state == 'ACTIVE';
  bool get needsAttention => !isActive || clockState != 'OK';

  static int _int(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse('${value ?? ''}') ?? 0;
  }

  static DateTime? _date(Object? value) {
    final text = value is String ? value : null;
    if (text == null || text.isEmpty) return null;
    return DateTime.tryParse(text)?.toLocal();
  }
}

/// Everything the licence screen does, in one place.
class LicenceDataSource {
  LicenceDataSource(this._client);

  final ApiClient _client;

  static const _path = '/license';

  Future<Map<String, dynamic>> status() => _client.get('$_path/status');

  Future<Map<String, dynamic>> requestCode() => _client.get('$_path/request-code');

  Future<Map<String, dynamic>> events() => _client.getObject('$_path/events');

  /// The four operations are four different endpoints on purpose: the server
  /// checks the key's signed type against the operation, so a seats key sent
  /// as an activation is refused before anything is written.
  Future<Map<String, dynamic>> apply(String operation, String key) {
    final route = switch (operation) {
      'activation' => 'activate',
      'renewal' => 'renew',
      'seats' => 'seats',
      'transfer' => 'transfer',
      _ => 'activate',
    };
    return _client.post('$_path/$route', body: {'key': key});
  }

  Future<Map<String, dynamic>> confirmClock() =>
      _client.post('$_path/confirm-clock');
}
