import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/notifications/presentation/screens/notification_center_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

const _user = AppUser(
  id: 'u1',
  username: 'accountant',
  fullName: 'Accountant',
  companyId: 'company-1',
  permissions: ['notifications.read'],
);

Future<GoRouter> _pumpBell(
  WidgetTester tester, {
  required int count,
  Locale locale = const Locale('en'),
}) async {
  final router = GoRouter(
    initialLocation: AppRoutes.dashboard,
    routes: [
      GoRoute(
        path: AppRoutes.dashboard,
        builder: (context, _) => Scaffold(
          appBar: AppBar(actions: const [NotificationBell()]),
          body: const SizedBox.expand(),
        ),
      ),
      GoRoute(
        path: AppRoutes.notifications,
        builder: (context, _) => Scaffold(body: Text(AppRoutes.notifications)),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        currentUserProvider.overrideWithValue(_user),
        notificationCountProvider.overrideWith((ref) async => count),
        notificationFeedProvider.overrideWith((ref) async => const <Json>[]),
      ],
      child: MaterialApp.router(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

void main() {
  testWidgets('the bell shows the unread count and opens the centre', (tester) async {
    await _pumpBell(tester, count: 3);

    expect(find.text('3'), findsOneWidget);
    await tester.tap(find.byType(NotificationBell));
    await tester.pumpAndSettle();
    expect(find.text(AppRoutes.notifications), findsOneWidget);
  });

  testWidgets('a bell with nothing to say shows no badge at all', (tester) async {
    await _pumpBell(tester, count: 0);

    final badge = tester.widget<Badge>(find.byType(Badge));
    expect(badge.isLabelVisible, isFalse);
  });

  testWidgets('the tooltip speaks the language of the screen', (tester) async {
    await _pumpBell(tester, count: 1, locale: const Locale('ar'));

    expect(find.byTooltip('التنبيهات'), findsOneWidget);
  });
}
