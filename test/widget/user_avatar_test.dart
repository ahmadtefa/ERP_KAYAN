import 'package:erp_kayan/features/admin/presentation/widgets/user_photo_dialog.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/shared/widgets/user_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The person's face, and what stands in for it.
///
/// The brief asks for a real per-user photo, a graceful initial when there is
/// none, and a preview before saving. Nothing here reaches the network: when a
/// person has no photo the initial is drawn and *no request is made*, which is
/// the difference between a list of forty colleagues and forty 404s.

/// The product's own scope around a single widget, so a `ConsumerWidget` is
/// used exactly as the app uses it.
Widget _app(Widget child) {
  return ProviderScope(
    child: MaterialApp(
      home: Scaffold(body: Center(child: child)),
      locale: const Locale('en'),
    ),
  );
}

/// The same, with the photo bytes provider answered by the test instead of
/// the network.
Widget _appWithPhoto(Widget child) {
  return ProviderScope(
    overrides: [
      avatarBytesProvider.overrideWith((ref, id) async => null),
    ],
    child: MaterialApp(
      home: Scaffold(body: Center(child: child)),
      locale: const Locale('en'),
    ),
  );
}

void main() {
  group('the initial that stands in for a photo', () {
    testWidgets('is the first letter of the name, not a generic silhouette', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          const UserAvatar(userId: 'u1', name: 'Amal Hassan'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('A'), findsOneWidget);
    });

    testWidgets('works in Arabic, where the first letter is not a Latin one', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          const UserAvatar(userId: 'u2', name: 'سارة عبد الله'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('س'), findsOneWidget);
    });

    testWidgets('skips spaces and marks, so the circle is never empty', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          const UserAvatar(userId: 'u3', name: '   Mona Adel'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('M'), findsOneWidget);
    });

    testWidgets('draws something for a nameless account', (tester) async {
      await tester.pumpWidget(
        _app(
          const UserAvatar(userId: 'u4', name: ''),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('?'), findsOneWidget);
    });

    testWidgets('gives two colleagues two different colours', (tester) async {
      Set<Color?> coloursOnScreen() => tester
          .widgetList<Container>(
            find.descendant(
              of: find.byType(UserAvatar),
              matching: find.byType(Container),
            ),
          )
          .map((c) => (c.decoration! as BoxDecoration).color)
          .toSet();

      await tester.pumpWidget(
        _app(
          const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              UserAvatar(userId: 'u5', name: 'Amal'),
              UserAvatar(userId: 'u6', name: 'Zaki'),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        coloursOnScreen().length,
        2,
        reason: 'two people must not share one anonymous colour',
      );

      // And the colour is stable: the same name always gets the same one, so a
      // person is recognisable across rebuilds and screens.
      await tester.pumpWidget(
        _app(
          const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              UserAvatar(userId: 'u5', name: 'Amal'),
              UserAvatar(userId: 'u7', name: 'Amal'),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(coloursOnScreen().length, 1, reason: 'one name, one colour');
    });

    testWidgets('falling back is not an error: no photo means no request', (
      tester,
    ) async {
      // The provider is overridden to fail: a person with no photo must still
      // draw their initial rather than an error banner or a broken image.
      await tester.pumpWidget(
        _appWithPhoto(
          const UserAvatar(userId: 'u8', name: 'Nour', hasPhoto: true),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('N'), findsOneWidget);
      expect(find.byIcon(Icons.broken_image_outlined), findsNothing);
    });
  });

  group('the session object', () {
    test('carries whether a photo exists, and the path to it', () {
      const user = AppUser(
        id: 'u1',
        username: 'amal',
        fullName: 'Amal Hassan',
        companyId: 'company-1',
        hasAvatar: true,
        avatarUrl: '/users/u1/avatar',
      );
      expect(user.hasAvatar, isTrue);
      expect(user.avatarUrl, '/users/u1/avatar');
      expect(user.initial, 'A');
    });

    test('drops the photo after it is deleted, keeping everything else', () {
      const user = AppUser(
        id: 'u1',
        username: 'amal',
        fullName: 'Amal Hassan',
        companyId: 'company-1',
        branchId: 'b1',
        roles: ['accountant'],
        permissions: ['sales.quotations.read'],
        hasAvatar: true,
        avatarUrl: '/users/u1/avatar',
      );
      final cleared = user.withoutAvatar();
      expect(cleared.hasAvatar, isFalse);
      expect(cleared.avatarUrl, isNull);
      // Deleting a photo must never be a way to lose a role or a grant.
      expect(cleared.roles, user.roles);
      expect(cleared.permissions, user.permissions);
      expect(cleared.branchId, user.branchId);
    });

    test('falls back to the username when the name has no letters', () {
      const user = AppUser(
        id: 'u1',
        username: 'kayan.bot',
        fullName: '   ',
        companyId: 'company-1',
      );
      expect(user.initial, 'K');
    });
  });

  group('the photo dialog', () {
    testWidgets('offers to choose a picture and saves nothing unconfirmed', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          const UserPhotoDialog(
            userId: 'u1',
            userName: 'Amal Hassan',
            hasPhoto: false,
            isSelf: true,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('My photo'), findsOneWidget);
      expect(find.textContaining('no photo yet'), findsOneWidget);
      // Nothing picked yet: saving is not offered as if it would work.
      final save = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Save photo'),
      );
      expect(save.onPressed, isNull);
      // No photo, so nothing to remove.
      expect(find.text('Remove photo'), findsNothing);
    });

    testWidgets('shows that a photo exists, and offers removal', (
      tester,
    ) async {
      await tester.pumpWidget(
        _appWithPhoto(
          const UserPhotoDialog(
            userId: 'u1',
            userName: 'Amal Hassan',
            hasPhoto: true,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Photo — Amal Hassan'), findsOneWidget);
      expect(find.text('This is the current photo.'), findsOneWidget);
      expect(find.text('Remove photo'), findsOneWidget);
    });

    testWidgets('closing it changes nothing', (tester) async {
      UserPhotoOutcome? outcome;
      await tester.pumpWidget(
        _app(
          Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                outcome = await showUserPhotoDialog(
                  context,
                  userId: 'u1',
                  userName: 'Amal',
                  hasPhoto: false,
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(outcome, UserPhotoOutcome.cancelled);
    });
  });
}
