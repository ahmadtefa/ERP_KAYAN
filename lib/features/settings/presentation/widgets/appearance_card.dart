import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/widgets/app_error_dialog.dart';
import '../providers/appearance_provider.dart';

class AppearanceCard extends ConsumerWidget {
  const AppearanceCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final value = ref.watch(appearanceProvider).value;
    Future<void> change(Future<void> Function() action) async {
      try {
        await action();
      } catch (error) {
        if (context.mounted) await showAppError(context, error);
      }
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              ar ? 'مظهر النظام والقوائم' : 'Appearance and navigation',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Text(ar ? 'مظهر النظام' : 'System appearance'),
            const SizedBox(height: 8),
            SegmentedButton<bool>(
              key: const Key('appearance-theme-choice'),
              segments: [
                ButtonSegment(
                  value: true,
                  label: Text(
                    ar ? 'فاتح، رمادي فاتح جدًا' : 'Light, pale gray',
                  ),
                ),
                ButtonSegment(
                  value: false,
                  label: Text(ar ? 'غامق، كحلي' : 'Dark, navy'),
                ),
              ],
              selected: {value?.light ?? false},
              onSelectionChanged: value == null
                  ? null
                  : (v) => change(
                      () => ref
                          .read(appearanceProvider.notifier)
                          .setTheme(v.single),
                    ),
            ),
            const SizedBox(height: 16),
            Text(ar ? 'شكل القوائم' : 'Navigation layout'),
            const SizedBox(height: 8),
            SegmentedButton<bool>(
              key: const Key('appearance-navigation-choice'),
              segments: [
                ButtonSegment(
                  value: false,
                  label: Text(ar ? 'قائمة جانبية' : 'Sidebar'),
                ),
                ButtonSegment(
                  value: true,
                  label: Text(ar ? 'قوائم علوية منسدلة' : 'Top dropdown menus'),
                ),
              ],
              selected: {value?.topNavigation ?? false},
              onSelectionChanged: value == null
                  ? null
                  : (v) => change(
                      () => ref
                          .read(appearanceProvider.notifier)
                          .setNavigation(v.single),
                    ),
            ),
            const SizedBox(height: 12),
            Text(
              ar
                  ? 'تُحفظ اختيارات العرض على هذا الجهاز. في النوافذ الضيقة تُستخدم قائمة جانبية لتسهيل الوصول.'
                  : 'Display choices are saved on this device. Narrow windows use a drawer for access.',
            ),
          ],
        ),
      ),
    );
  }
}
