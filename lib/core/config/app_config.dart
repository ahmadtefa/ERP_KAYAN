/// Environment-based configuration.
///
/// Values are injected at build time via `--dart-define` so that no
/// environment-specific URL is ever hardcoded in the source tree.
///
/// Example:
///   flutter run --dart-define=APP_ENV=staging \
///               --dart-define=API_BASE_URL=https://staging.example.com/api/v1
enum AppEnvironment { development, staging, production, onPremise }

class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.connectTimeout,
    required this.receiveTimeout,
    this.enableLogging = false,
    this.useSeedData = false,
  });

  final AppEnvironment environment;
  final String apiBaseUrl;
  final Duration connectTimeout;
  final Duration receiveTimeout;
  final bool enableLogging;

  /// When true the client may fall back to locally generated seed records so
  /// the UI can be exercised before a backend is available.
  ///
  /// REQUIRES BUSINESS DECISION: the real backend for this ERP has not been
  /// selected yet, so seed data exists purely as a development aid. It is
  /// never persisted and never treated as a system of record.
  final bool useSeedData;

  static const String _envName = String.fromEnvironment(
    'APP_ENV',
    defaultValue: 'development',
  );
  static const String _baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );
  static const bool _logging = bool.fromEnvironment(
    'ENABLE_LOGGING',
    defaultValue: true,
  );

  /// Builds the runtime configuration from compile-time dart-defines.
  factory AppConfig.fromEnvironment() {
    final env = switch (_envName.toLowerCase()) {
      'staging' => AppEnvironment.staging,
      'production' || 'prod' => AppEnvironment.production,
      'onpremise' || 'on-premise' || 'onprem' => AppEnvironment.onPremise,
      _ => AppEnvironment.development,
    };

    return AppConfig(
      environment: env,
      apiBaseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
      enableLogging: _logging && env != AppEnvironment.production,
      // Seed data is permitted in development only. Staging, production and
      // on-premise builds must talk to a real API.
      useSeedData: env == AppEnvironment.development,
    );
  }

  bool get isProduction => environment == AppEnvironment.production;
}
