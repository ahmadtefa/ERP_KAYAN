import 'package:erp_kayan/features/licensing/data/licence_data_source.dart';
import 'package:erp_kayan/features/licensing/presentation/providers/licence_providers.dart';
import 'package:erp_kayan/features/licensing/presentation/screens/licence_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final _status = LicenceStatus.fromJson({
  'state': 'ACTIVE', 'blocked': false, 'configured': true, 'enforcement': 'enforce',
  'licenseId': 'SYNTHETIC', 'issuedAt': '2026-03-05T00:00:00Z', 'expiresAt': '2027-01-01T00:00:00Z',
  'daysRemaining': 35,
});

void main() {
  for (final arabic in [true, false]) {
    testWidgets('licence dates show the year (${arabic ? 'ar' : 'en'})', (tester) async {
      tester.view.physicalSize = const Size(1400, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(ProviderScope(
        overrides: [licenceStatusProvider.overrideWith((ref) async => _status)],
        child: MaterialApp(
          locale: Locale(arabic ? 'ar' : 'en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: LicenceScreen()),
        ),
      ));
      await tester.pumpAndSettle();
      final year = arabic ? '٢٠٢٧' : '2027';
      expect(find.textContaining(year), findsWidgets);
      expect(find.textContaining(arabic ? '٢٠٢٦' : '2026'), findsWidgets);
    });
  }
}
