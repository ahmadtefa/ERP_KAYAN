import 'package:erp_kayan/features/licensing/data/licence_data_source.dart';
import 'package:erp_kayan/features/licensing/presentation/providers/licence_providers.dart';
import 'package:erp_kayan/features/licensing/presentation/widgets/licence_gate.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final entry in [
    (state:'REVOKED', text:'الترخيص ملغى أو حالته غير صالحة'),
    (state:'INVALID_STATUS', text:'الترخيص ملغى أو حالته غير صالحة'),
    (state:'NOT_YET_VALID', text:'لم يبدأ سريان الترخيص بعد'),
  ]) {
    testWidgets('blocked ${entry.state} explains the status and preserves backup access', (tester) async {
      tester.view.physicalSize=const Size(1400,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(ProviderScope(overrides:[licenceStatusProvider.overrideWith((ref) async =>
        LicenceStatus.fromJson({'state':entry.state,'blocked':true,'configured':true,'enforcement':'enforce'}))],
        child:MaterialApp(locale:const Locale('ar'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:LicenceGate(
            currentPath:'/sales', child:Text('Business screen'))))));
      await tester.pumpAndSettle();
      expect(find.textContaining(entry.text),findsOneWidget);
      expect(find.text('Business screen'),findsNothing);
      expect(find.byIcon(Icons.backup_outlined),findsOneWidget);
      expect(tester.takeException(),isNull);
    });
  }
}
