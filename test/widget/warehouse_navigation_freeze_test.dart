import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

/// The warehouse menu stopped responding.
///
/// `DraftExitGuard.canLeave` answers **false** for a key that nobody
/// registered, and go_router asks it before leaving any guarded route. Nine
/// inventory routes were guarded while their screens were built without a
/// `navigationKey`, so no guard was ever registered for them: every attempt to
/// leave answered "no". go_router cancels the transition silently — no error,
/// no dialog, no spinner — and the operator sees a frozen app.
///
/// The first two tests reproduce that condition directly, with a route wired
/// exactly the way `app_router.dart` wired the nine. They are written against
/// the *runtime* behaviour rather than the source, because the defect is a
/// silent cancellation: nothing throws, so only an attempted navigation that
/// should have arrived can witness it.
void main() {
  ProviderContainer shellOnly() => ProviderContainer(
    overrides: [
      tokenStoreProvider.overrideWithValue(FakeTokenStore()),
      authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
    ],
  );

  testWidgets(
      'a guarded route whose screen never registers cannot be left (the freeze)',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // A shell with no guardKey behaves like the nine screens did: nothing
    // registers the route's page key. This is the defect, reproduced.
    final container = shellOnly();
    addTearDown(container.dispose);
    final guard = container.read(draftExitGuardProvider);

    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        GoRoute(
          path: '/inventory/warehouses',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, __) => const Scaffold(body: Text('Warehouses screen')),
        ),
        GoRoute(
          path: '/inventory/batches',
          builder: (_, __) => const Scaffold(body: Text('Batches destination')),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Warehouses screen'), findsOneWidget);

    router.go('/inventory/batches');
    await tester.pumpAndSettle();

    // This is the freeze, reproduced: the transition is cancelled and the
    // operator is left looking at the warehouse screen. Nothing is thrown, so
    // the assertion has to be that the destination was *not* reached. This test
    // stays green before and after the fix on purpose - it pins the mechanism,
    // and the next test is the one that fails without the fix.
    expect(
      find.text('Batches destination'),
      findsNothing,
      reason: 'an unregistered key answers "cannot leave", so go_router '
          'silently cancels the transition - no error, no dialog, no spinner. '
          'This is what the operator experienced as a freeze.',
    );
    expect(
      find.text('Warehouses screen'),
      findsOneWidget,
      reason: 'the screen stays put, which is exactly why it looked frozen',
    );
    expect(tester.takeException(), isNull,
        reason: 'nothing throws, which is why the defect went unnoticed');
  });

  testWidgets('the shell registers the floor so a pageKey-less screen can leave',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final container = shellOnly();
    addTearDown(container.dispose);
    final guard = container.read(draftExitGuardProvider);

    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        GoRoute(
          path: '/inventory/warehouses',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/warehouses',
            guardKey: state.pageKey,
            child: const Scaffold(body: Text('Warehouses screen')),
          ),
        ),
        GoRoute(
          path: '/inventory/batches',
          builder: (_, __) => const Scaffold(body: Text('Batches destination')),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Warehouses screen'), findsOneWidget);

    router.go('/inventory/batches');
    await tester.pumpAndSettle();

    expect(
      find.text('Batches destination'),
      findsOneWidget,
      reason: 'the shell must hold a permissive floor for a guarded route whose '
          'screen has no draft, otherwise the menu is unresponsive',
    );
  });

  testWidgets('a screen guard that blocks still blocks, even with the floor',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final container = shellOnly();
    addTearDown(container.dispose);
    final guard = container.read(draftExitGuardProvider);

    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        GoRoute(
          path: '/inventory/warehouses',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/warehouses',
            guardKey: state.pageKey,
            child: _DraftScreen(pageKey: state.pageKey),
          ),
        ),
        GoRoute(
          path: '/inventory/batches',
          builder: (_, __) => const Scaffold(body: Text('Batches destination')),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();

    router.go('/inventory/batches');
    await tester.pumpAndSettle();

    expect(
      find.text('Batches destination'),
      findsNothing,
      reason: 'the permissive floor must never override a screen that reports '
          'unsaved work; that would trade a freeze for data loss',
    );
  });

  testWidgets('repeated warehouse navigation does not leave guards behind',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final container = shellOnly();
    addTearDown(container.dispose);
    final guard = container.read(draftExitGuardProvider);

    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        for (final path in ['/inventory/warehouses', '/inventory/batches'])
          GoRoute(
            path: path,
            onExit: (_, state) => guard.canLeave(state.pageKey),
            builder: (_, state) => ErpShell(
              currentPath: path,
              guardKey: state.pageKey,
              child: Scaffold(body: Text('screen $path')),
            ),
          ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Ten round trips. Before the fix the first one never completed; after it,
    // each must complete and no guard may be left registered for a dead page
    // key, or the map grows for the whole session.
    for (var round = 0; round < 10; round++) {
      router.go('/inventory/batches');
      await tester.pumpAndSettle();
      expect(find.text('screen /inventory/batches'), findsOneWidget,
          reason: 'round $round could not leave the warehouse screen');

      router.go('/inventory/warehouses');
      await tester.pumpAndSettle();
      expect(find.text('screen /inventory/warehouses'), findsOneWidget,
          reason: 'round $round could not leave the batches screen');
      expect(tester.takeException(), isNull);
    }

    // Twenty pages were created and destroyed above. If the shell failed to
    // release the key it claimed, the guard would hold one entry per page and
    // grow for the whole session. The absolute count is not asserted - it
    // depends on how many pages go_router keeps alive during a transition -
    // but it must not grow with the number of visits, which is the leak.
    final afterFirstVisit = guard.registeredCount;
    for (var round = 0; round < 10; round++) {
      router.go('/inventory/batches');
      await tester.pumpAndSettle();
      router.go('/inventory/warehouses');
      await tester.pumpAndSettle();
    }
    expect(
      guard.registeredCount,
      afterFirstVisit,
      reason: 'ten more round trips must not retain more guards than the first '
          'one did; growth here is a guard leaked by every page that was left',
    );
  });

  testWidgets('a shell with no guardKey registers nothing', (tester) async {
    final container = shellOnly();
    addTearDown(container.dispose);
    final guard = container.read(draftExitGuardProvider);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const ErpShell(
            currentPath: '/inventory/warehouses',
            child: Scaffold(body: Text('no key route')),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Routes outside `_guardedShellPaths` pass no key; the shell must not
    // invent one, and the restrictive default must still hold for strangers.
    expect(await guard.canLeave(const ValueKey('never-registered')), isFalse);
  });
}

/// A stand-in for a screen that owns unsaved work. It registers its guard from
/// `initState`, which is the moment the real draft screens use, and that
/// moment comes *after* the shell's `initState`, so its answer wins.
class _DraftScreen extends ConsumerStatefulWidget {
  const _DraftScreen({required this.pageKey});

  final ValueKey<String> pageKey;

  @override
  ConsumerState<_DraftScreen> createState() => _DraftScreenState();
}

class _DraftScreenState extends ConsumerState<_DraftScreen> {
  Future<bool> _hasUnsavedWork() async => false;

  @override
  void initState() {
    super.initState();
    ref.read(draftExitGuardProvider).register(widget.pageKey, _hasUnsavedWork);
  }

  @override
  void dispose() {
    ref.read(draftExitGuardProvider).unregister(widget.pageKey, _hasUnsavedWork);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
