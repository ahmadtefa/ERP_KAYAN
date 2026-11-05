import 'package:erp_kayan/features/common/presentation/screens/module_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  testWidgets('module header back returns to dashboard at the root', (tester) async {
    final router = GoRouter(
      initialLocation: '/module',
      routes: [
        GoRoute(
          path: '/dashboard',
          builder: (context, state) =>
              const Scaffold(body: Center(child: Text('Dashboard'))),
        ),
        GoRoute(
          path: '/module',
          builder: (context, state) => const Scaffold(
            body: ModuleScaffold(
              title: 'Module',
              body: Center(child: Text('Module body')),
            ),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    expect(find.text('Module body'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Dashboard'), findsOneWidget);
  });

  testWidgets('module header back pops to the previous route when available', (tester) async {
    final router = GoRouter(
      initialLocation: '/module/detail',
      routes: [
        GoRoute(
          path: '/module',
          builder: (context, state) =>
              const Scaffold(body: Center(child: Text('Module list'))),
          routes: [
            GoRoute(
              path: 'detail',
              builder: (context, state) => const Scaffold(
                body: ModuleScaffold(
                  title: 'Detail',
                  body: Center(child: Text('Detail body')),
                ),
              ),
            ),
          ],
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    expect(find.text('Detail body'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Module list'), findsOneWidget);
  });
}
