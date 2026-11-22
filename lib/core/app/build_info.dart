/// Build identity embedded by the supported Windows build pipeline.
///
/// Development builds may intentionally leave the commit as `unknown`; a
/// shipped binary should carry the exact Git revision and dirty-tree marker so
/// the About screen can distinguish the Flutter executable from the API it
/// actually started.
abstract final class AppBuildInfo {
  static const version = String.fromEnvironment(
    'KAYAN_APP_VERSION',
    defaultValue: '0.1.0+1',
  );
  static const sourceCommit = String.fromEnvironment(
    'KAYAN_SOURCE_COMMIT',
    defaultValue: 'unknown',
  );
  static const sourceDirty = String.fromEnvironment(
    'KAYAN_SOURCE_DIRTY',
    defaultValue: 'unknown',
  );
}
