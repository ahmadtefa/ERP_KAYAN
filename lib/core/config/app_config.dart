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
  });

  final AppEnvironment environment;
  final String apiBaseUrl;
  final Duration connectTimeout;
  final Duration receiveTimeout;
  final bool enableLogging;

  static const String _envName =
      String.fromEnvironment('APP_ENV', defaultValue: 'development');
  static const String _baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:8080/api/v1',
  );
  static const bool _logging =
      bool.fromEnvironment('ENABLE_LOGGING', defaultValue: true);

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
    );
  }

  bool get isProduction => environment == AppEnvironment.production;
}
