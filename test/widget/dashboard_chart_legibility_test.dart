import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/features/dashboard/presentation/widgets/dashboard_panels.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for(final dark in [true,false]) {
    for(final width in [320.0,1366.0]) {
      testWidgets('monthly chart readable values remain bounded at $width dark=$dark', (tester) async {
        tester.view.physicalSize=Size(width,500);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(MaterialApp(theme:dark?AppTheme.dark():AppTheme.light(),home:Directionality(textDirection:TextDirection.rtl,child:Scaffold(body:Padding(padding:const EdgeInsets.all(16),child:MonthlyBarsChart(months:[for(var i=1;i<=12;i++) {'month':'2026-${i.toString().padLeft(2,'0')}','sales':1250,'purchases':987654321,'result':-250}],arabic:true,showPurchases:false))))));
        await tester.pumpAndSettle();expect(tester.takeException(),isNull);
        final firstPosition=tester.getCenter(find.byType(Tooltip).first);final lastPosition=tester.getCenter(find.byType(Tooltip).last);expect(firstPosition.dx,lessThan(lastPosition.dx));
        final tips=tester.widgetList<Tooltip>(find.byType(Tooltip)).toList();expect(tips.length,12);
        expect(tips.first.message,contains('2026-01'));expect(tips.first.message,contains('1250'));expect(tips.first.message,contains('-250'));expect(tips.first.message,isNot(contains('987654321')));expect(tips.first.message,isNot(contains('المشتريات')));
        await tester.tap(find.byType(Tooltip).first);await tester.pumpAndSettle();expect(find.textContaining('2026-01'),findsOneWidget);expect(find.textContaining('1250'),findsOneWidget);expect(tester.takeException(),isNull);
      });
    }
  }
  test('shared dark surfaces preserve legible normal text contrast', () {
    final theme=AppTheme.dark();final s=theme.colorScheme;
    double ratio(Color a,Color b) {final x=a.computeLuminance(),y=b.computeLuminance();return (x>y?x+0.05:y+0.05)/(x>y?y+0.05:x+0.05);}
    for(final bg in [s.surface,s.surfaceContainerHigh,s.surfaceContainerHighest,theme.scaffoldBackgroundColor]) {
      expect(ratio(s.onSurface,bg),greaterThanOrEqualTo(4.5));expect(ratio(s.onSurfaceVariant,bg),greaterThanOrEqualTo(4.5));
    }
  });
}
