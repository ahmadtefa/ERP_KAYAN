import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/app/build_info.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../auth/presentation/widgets/user_photo.dart';
import '../providers/company_providers.dart';
import '../providers/locale_provider.dart';
import '../widgets/lan_access_card.dart';
import '../widgets/reset_data_card.dart';
import '../widgets/document_settings_card.dart';
import '../widgets/text_scale_card.dart';

final _runtimeBuildInfoProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) => ref.read(apiClientProvider).get('/health'),
);

String _shortCommit(String commit) =>
    commit.length >= 12 ? commit.substring(0, 12) : commit;

/// Application settings.
///
/// Currently exposes locale selection and session information. Nothing here
/// mutates financial data.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  static const appVersion = AppBuildInfo.version;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final locale = ref.watch(localeControllerProvider).value;
    final companyAsync = ref.watch(companyProfileProvider);
    final company = companyAsync.asData?.value;
    final runtimeBuild = ref.watch(_runtimeBuildInfoProvider).asData?.value;
    final apiCommit = runtimeBuild?['sourceCommit'] is String
        ? runtimeBuild!['sourceCommit'] as String
        : 'unknown';
    final appCommit = AppBuildInfo.sourceCommit;
    final commitMismatch = appCommit != 'unknown' &&
        apiCommit != 'unknown' &&
        appCommit != apiCommit;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final dirtyLabel = AppBuildInfo.sourceDirty == 'true'
        ? (isArabic ? ' · مصدر غير نظيف' : ' · dirty source')
        : '';
    final apiStateLabel = runtimeBuild == null
        ? (isArabic ? ' · غير متصل' : ' · unavailable')
        : '';
    final nameAr = (company?['nameAr'] as String?)?.trim() ?? '';
    final nameEn = (company?['nameEn'] as String?)?.trim() ?? '';
    final companyName = isArabic
        ? (nameAr.isNotEmpty ? nameAr : nameEn)
        : (nameEn.isNotEmpty ? nameEn : nameAr);
    final companyDisplay = companyName.isNotEmpty
        ? companyName
        : ((user?.companyId.isNotEmpty ?? false)
            ? user!.companyId
            : l10n.notAvailable);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(title: l10n.settings, subtitle: l10n.aboutDescription),
        Container(
          height: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xxl),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 920),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.person_outline),
                title: Text(l10n.signedInAs),
                subtitle: Text(user?.fullName ?? l10n.notAvailable),
              ),
              ListTile(
                leading: const Icon(Icons.business_outlined),
                title: Text(l10n.company),
                subtitle: Text(companyDisplay),
              ),
              ListTile(
                leading: const Icon(Icons.location_on_outlined),
                title: Text(l10n.branch),
                subtitle: Text(user?.branchId ?? l10n.notAvailable),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const UserPhotoCard(),
        const SizedBox(height: 16),
        const TextScaleCard(),
        const SizedBox(height: 16),
        const LanAccessCard(),
        const SizedBox(height: 16),
        const DocumentSettingsCard(),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.language,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(
                      value: 'system',
                      label: Text(l10n.systemDefault),
                    ),
                    ButtonSegment(value: 'en', label: Text(l10n.english)),
                    ButtonSegment(value: 'ar', label: Text(l10n.arabic)),
                  ],
                  selected: {locale?.languageCode ?? 'system'},
                  onSelectionChanged: (selection) {
                    final value = selection.first;
                    ref
                        .read(localeControllerProvider.notifier)
                        .setLocale(value == 'system' ? null : Locale(value));
                  },
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        // The licence screen: state, the activation code, and the one place a
        // key is entered. Visible to everyone, because the person at the
        // machine is often the one who has to read the code out.
        Card(
          child: ListTile(
            leading: const Icon(Icons.verified_user_outlined),
            title: Text(l10n.licence),
            subtitle: Text(l10n.licenceSettingsSubtitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.go(AppRoutes.licence),
          ),
        ),
        const SizedBox(height: 16),
        // Only an administrator sees this, and only when there is something
        // to reset. Everything about it is enforced again on the server.
        const ResetDataCard(),
        const SizedBox(height: 16),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(l10n.about),
                subtitle: Text(
                  [
                    l10n.aboutDescription,
                    '${l10n.version}: $appVersion',
                    '${isArabic ? 'بناء الواجهة' : 'Client build'}: '
                        '${_shortCommit(appCommit)}$dirtyLabel',
                    '${isArabic ? 'بناء الخادم' : 'API build'}: '
                        '${_shortCommit(apiCommit)}$apiStateLabel',
                    if (commitMismatch)
                      isArabic
                          ? 'تحذير: الواجهة والخادم من مصدرين مختلفين.'
                          : 'Warning: client and server source commits differ.',
                  ].join('\n'),
                  style: commitMismatch
                      ? TextStyle(color: Theme.of(context).colorScheme.error)
                      : null,
                ),
                isThreeLine: true,
              ),
            ],
          ),
        ),
                    const SizedBox(height: AppSpacing.xxl),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: FilledButton.tonalIcon(
                        onPressed: () =>
                            ref.read(authControllerProvider.notifier).signOut(),
                        icon: const Icon(Icons.logout, size: 18),
                        label: Text(l10n.signOut),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
