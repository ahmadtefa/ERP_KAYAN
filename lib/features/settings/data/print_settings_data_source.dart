import '../../../core/network/api_client.dart';

/// One kind of print the program can produce, as the server describes it.
class PrintType {
  const PrintType({
    required this.key,
    required this.category,
    required this.labelEn,
    required this.labelAr,
    required this.carriesSalePrice,
    required this.carriesCost,
  });

  factory PrintType.fromJson(Map<String, dynamic> json) => PrintType(
    key: '${json['key'] ?? ''}',
    category: '${json['category'] ?? 'DOCUMENT'}',
    labelEn: '${json['labelEn'] ?? json['key'] ?? ''}',
    labelAr: '${json['labelAr'] ?? json['labelEn'] ?? json['key'] ?? ''}',
    carriesSalePrice: json['carriesSalePrice'] == true,
    carriesCost: json['carriesCost'] == true,
  );

  /// The key the API and the screen agree on; also the route slug.
  final String key;
  final String category;
  final String labelEn;
  final String labelAr;

  /// Whether this print can show a selling price at all. A journal entry
  /// cannot, so no switch is offered for it.
  final bool carriesSalePrice;
  final bool carriesCost;

  String label(bool arabic) => arabic ? labelAr : labelEn;
}

/// A saved choice for one print type.
class PrintPriceSetting {
  const PrintPriceSetting({
    required this.showSalePrice,
    required this.showCost,
  });

  factory PrintPriceSetting.fromJson(Map<String, dynamic>? json) =>
      PrintPriceSetting(
        showSalePrice: json?['showSalePrice'] != false,
        showCost: json?['showCost'] != false,
      );

  final bool showSalePrice;
  final bool showCost;

  Map<String, dynamic> toJson(String documentType) => {
    'documentType': documentType,
    'showSalePrice': showSalePrice,
    'showCost': showCost,
  };

  PrintPriceSetting copyWith({bool? showSalePrice, bool? showCost}) =>
      PrintPriceSetting(
        showSalePrice: showSalePrice ?? this.showSalePrice,
        showCost: showCost ?? this.showCost,
      );
}

/// The company's print policy, as the server holds it.
///
/// It is a company-wide setting stored in the database, not a preference on
/// this machine: it must survive a reinstall, follow the company into a backup
/// and mean the same thing for every operator at every station.
class PrintSettings {
  const PrintSettings({
    required this.types,
    required this.settings,
    required this.defaults,
    required this.costLocked,
  });

  factory PrintSettings.fromJson(Map<String, dynamic> json) {
    final types = (json['types'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(PrintType.fromJson)
        .toList(growable: false);
    final saved = <String, PrintPriceSetting>{};
    for (final row in (json['settings'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()) {
      final key = '${row['documentType'] ?? ''}';
      if (key.isEmpty) continue;
      saved[key] = PrintPriceSetting.fromJson(row);
    }
    return PrintSettings(
      types: types,
      settings: saved,
      defaults: PrintPriceSetting.fromJson(
        json['default'] as Map<String, dynamic>?,
      ),
      costLocked: json['costLocked'] == true,
    );
  }

  final List<PrintType> types;

  /// Only the types the company configured. A missing key means "use the
  /// default", which is not the same as "saved as visible".
  final Map<String, PrintPriceSetting> settings;

  /// What the company decided for everything it did not configure.
  final PrintPriceSetting defaults;

  /// True when this caller may never read a cost, whatever is saved: the
  /// server enforces the same floor, so a switch here changes nothing.
  final bool costLocked;

  PrintType? type(String key) {
    for (final type in types) {
      if (type.key == key) return type;
    }
    return null;
  }

  /// The document type that decides the defaults for [key]: its own saved row,
  /// then the company default, then the built-in default (visible).
  PrintPriceSetting forType(String key) =>
      settings[key] ?? defaults;
}

/// Reads and writes the saved print policy.
class PrintSettingsDataSource {
  PrintSettingsDataSource(this._client);

  final ApiClient _client;

  static const _path = '/company/print-settings';

  Future<PrintSettings> fetch() async =>
      PrintSettings.fromJson(await _client.get(_path));

  Future<PrintSettings> save(List<PrintPriceSetting> settings, List<String> keys) async {
    final payload = <Map<String, dynamic>>[
      for (var index = 0; index < settings.length; index += 1)
        settings[index].toJson(keys[index]),
    ];
    return PrintSettings.fromJson(
      await _client.put(_path, body: {'settings': payload}),
    );
  }
}
