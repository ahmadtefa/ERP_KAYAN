import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/company_data_source.dart';

final companyDataSourceProvider = Provider<CompanyDataSource>(
  (ref) => CompanyDataSource(ref.watch(apiClientProvider)),
);

/// The company profile: names, code, contact details, logo flag.
class CompanyProfileController extends AsyncNotifier<Map<String, dynamic>> {
  @override
  Future<Map<String, dynamic>> build() {
    final user = ref.watch(currentUserProvider);
    if (user == null) return Future.value(const <String, dynamic>{});
    return ref.read(companyDataSourceProvider).fetchProfile();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(
      () => ref.read(companyDataSourceProvider).fetchProfile(),
    );
  }

  /// Returns an error message, or null on success.
  Future<String?> updateProfile(Map<String, dynamic> patch) async {
    try {
      final updated = await ref
          .read(companyDataSourceProvider)
          .updateProfile(patch);
      state = AsyncValue.data(updated);
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }

  Future<String?> uploadLogo(PickedFile file) async {
    try {
      await ref.read(companyDataSourceProvider).uploadLogo(file);
      await refresh();
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }

  Future<String?> removeLogo() async {
    try {
      await ref.read(companyDataSourceProvider).removeLogo();
      await refresh();
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }
}

final companyProfileProvider =
    AsyncNotifierProvider<CompanyProfileController, Map<String, dynamic>>(
      CompanyProfileController.new,
    );

/// The units: the headquarters and every branch.
class BranchesController extends AsyncNotifier<List<Map<String, dynamic>>> {
  @override
  Future<List<Map<String, dynamic>>> build() {
    final user = ref.watch(currentUserProvider);
    if (user == null) return Future.value(const <Map<String, dynamic>>[]);
    return ref.read(companyDataSourceProvider).fetchBranches();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(
      () => ref.read(companyDataSourceProvider).fetchBranches(),
    );
  }

  Future<String?> create(Map<String, dynamic> body) =>
      _mutate(() => ref.read(companyDataSourceProvider).createBranch(body));

  Future<String?> updateBranch(String id, Map<String, dynamic> body) =>
      _mutate(() => ref.read(companyDataSourceProvider).updateBranch(id, body));

  Future<String?> remove(String id) => _mutate(() async {
    await ref.read(companyDataSourceProvider).deleteBranch(id);
    return <String, dynamic>{};
  });

  Future<String?> _mutate(
    Future<Map<String, dynamic>> Function() action,
  ) async {
    try {
      await action();
      ref.invalidateSelf();
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }
}

final branchesProvider =
    AsyncNotifierProvider<BranchesController, List<Map<String, dynamic>>>(
      BranchesController.new,
    );
