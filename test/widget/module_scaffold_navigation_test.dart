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

  testWidgets('root fallback honours an asynchronous route exit guard', (tester) async {
    var exitChecks = 0;
    final router = GoRouter(initialLocation: '/module', routes: [
      GoRoute(path: '/dashboard', builder: (_, _) => const Scaffold(body: Text('Dashboard'))),
      GoRoute(path: '/module', onExit: (_, _) async { exitChecks++; return false; },
        builder: (_, _) => const Scaffold(body: ModuleScaffold(
          title: 'Protected', body: Text('Unsaved draft')))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    expect(exitChecks, 1);
    expect(find.text('Unsaved draft'), findsOneWidget);
    expect(find.text('Dashboard'), findsNothing);
  });

  testWidgets('back does not bypass a blocked pop or replace a custom leading', (tester) async {
    final router = GoRouter(initialLocation: '/module/detail', routes: [
      GoRoute(path: '/module', builder: (_, _) => const Scaffold(body: Text('Module list')), routes: [
        GoRoute(path: 'detail', builder: (_, _) => const PopScope(canPop: false,
          child: Scaffold(body: ModuleScaffold(title: 'Protected', body: Text('Unsaved draft'))))),
      ]),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Unsaved draft'), findsOneWidget);
    expect(find.text('Module list'), findsNothing);

    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ModuleScaffold(
      title: 'Custom', leading: Icon(Icons.close), body: Text('Body')))));
    expect(find.byIcon(Icons.close), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back_rounded), findsNothing);
  });
}
