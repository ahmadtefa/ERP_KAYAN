import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/reset_data_source.dart';

/// Talks to the reset routes.
final resetDataSourceProvider = Provider<ResetDataSource>(
  (ref) => ResetDataSource(ref.watch(apiClientProvider)),
);

/// What a reset would remove, fetched before anything is typed.
///
/// Auto-dispose, because the numbers go stale the moment someone records
/// something: a warning should be counted again rather than remembered from
/// an hour ago.
final resetPreviewProvider = FutureProvider.autoDispose<ResetPreview>(
  (ref) => ref.watch(resetDataSourceProvider).preview(),
);
