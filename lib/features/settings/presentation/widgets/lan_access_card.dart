import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/extensions/l10n_extension.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

final networkInfoProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final client = ref.watch(apiClientProvider);
  try {
    return await client.get('/health/network');
  } catch (_) {
    return const <String, dynamic>{};
  }
});

/// Displays the local LAN access address (IP and Port 3000) and step-by-step
/// instructions for connecting from other devices (phones, tablets, PCs)
/// on the same company router.
class LanAccessCard extends ConsumerWidget {
  const LanAccessCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final networkAsync = ref.watch(networkInfoProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.wifi_tethering, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    isArabic
                        ? 'الدخول من جهاز آخر على شبكة الشركة (LAN)'
                        : 'Local Network Access (LAN)',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: l10n.refreshStatus,
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: () => ref.invalidate(networkInfoProvider),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              isArabic
                  ? 'يمكن للأجهزة الأخرى (أجهزة كمبيوتر، هواتف، أجهزة لوحية) فتح برنامج KAYAN ERP مباشرة عبر متصفح الويب دون الحاجة لتثبيت أي برامج.'
                  : 'Other devices (PCs, phones, tablets) can use KAYAN ERP directly through their web browser without installing anything.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            networkAsync.when(
              loading: () => const LinearProgressIndicator(),
              error: (_, _) => const SizedBox.shrink(),
              data: (data) {
                final port = data['port'] ?? 3000;
                final addresses = data['addresses'] as List<dynamic>? ?? [];
                final primaryUrl = data['primaryUrl'] as String? ??
                    (addresses.isNotEmpty
                        ? (addresses.first['url'] as String? ?? 'http://192.168.1.2:$port')
                        : 'http://localhost:$port');

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primaryContainer.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: theme.colorScheme.primary.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.link, color: theme.colorScheme.primary),
                          const SizedBox(width: 8),
                          Expanded(
                            child: SelectableText(
                              primaryUrl,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                                color: theme.colorScheme.primary,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: isArabic ? 'نسخ الرابط' : 'Copy link',
                            icon: const Icon(Icons.copy, size: 18),
                            onPressed: () {
                              Clipboard.setData(ClipboardData(text: primaryUrl));
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    isArabic
                                        ? 'تم نسخ رابط الوصول للشبكة المحلية: $primaryUrl'
                                        : 'Copied LAN address: $primaryUrl',
                                  ),
                                  duration: const Duration(seconds: 3),
                                ),
                              );
                            },
                          ),
                        ],
                      ),
                    ),
                    if (addresses.length > 1) ...[
                      const SizedBox(height: 8),
                      Text(
                        isArabic ? 'عناوين إضافية للشبكة:' : 'Alternative addresses:',
                        style: theme.textTheme.labelMedium,
                      ),
                      for (final item in addresses.skip(1))
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: SelectableText(
                            '• ${item['interface']}: ${item['url']}',
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                    ],
                    const SizedBox(height: 16),
                    Text(
                      isArabic ? 'شروط وتعليمات الاتصال:' : 'Connection Instructions:',
                      style: theme.textTheme.titleSmall,
                    ),
                    const SizedBox(height: 6),
                    _InstructionStep(
                      number: '1',
                      text: isArabic
                          ? 'تأكد من اتصال الجهاز الآخر بنفس شبكة الراوتر (واي فاي Wi-Fi أو كابل إيثرنت).'
                          : 'Connect the other device to the same local network (Wi-Fi or Ethernet).',
                    ),
                    _InstructionStep(
                      number: '2',
                      text: isArabic
                          ? 'افتح متصفح الويب (Google Chrome أو Microsoft Edge) على الجهاز الآخر.'
                          : 'Open a web browser (Chrome or Edge) on the other device.',
                    ),
                    _InstructionStep(
                      number: '3',
                      text: isArabic
                          ? 'اكتب الرابط أعلاه بالكامل متضمنًا المنفذ (مثل: $primaryUrl).'
                          : 'Enter the full address including port (e.g. $primaryUrl).',
                    ),
                    _InstructionStep(
                      number: '4',
                      text: isArabic
                          ? 'سجّل الدخول بحساب المستخدم الخاص بك واستخدم النظام كالمعتاد.'
                          : 'Sign in with your credentials and use the system normally.',
                    ),
                    _InstructionStep(
                      number: '5',
                      text: isArabic
                          ? 'جدار الحماية (Windows Firewall): تم ضبط السماح للمنفذ $port تلقائياً أثناء التثبيت للشبكات الخاصة.'
                          : 'Windows Firewall: Port $port is automatically allowed for private networks.',
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _InstructionStep extends StatelessWidget {
  const _InstructionStep({required this.number, required this.text});

  final String number;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 9,
            backgroundColor: theme.colorScheme.primary,
            child: Text(
              number,
              style: TextStyle(
                fontSize: 10,
                color: theme.colorScheme.onPrimary,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}
