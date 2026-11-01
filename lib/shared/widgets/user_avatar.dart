import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/design_tokens.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../core/error/failure.dart';

/// Bumped whenever a photo is uploaded or removed, so every avatar on screen
/// re-reads it.
///
/// Without this a person changes their picture and keeps seeing the old one in
/// the top bar and the user list, because the bytes were fetched once and
/// cached - the classic "it changed but only after a restart" bug.
class AvatarRevision extends Notifier<int> {
  @override
  int build() => 0;

  /// Invalidates every cached photo without knowing who is on screen.
  void bump() => state = state + 1;
}

final avatarRevisionProvider = NotifierProvider<AvatarRevision, int>(
  AvatarRevision.new,
);

/// One person's photo bytes, cached per user id and revision.
final avatarBytesProvider =
    FutureProvider.family<Uint8List?, String>((ref, userId) async {
      // A revision change re-runs every family member: the identity of the
      // item includes the revision, so the old bytes are not served again.
      ref.watch(avatarRevisionProvider);
      final client = ref.watch(apiClientProvider);
      try {
        return await client.getBytes('/users/$userId/avatar');
      } on Failure {
        // No photo, or the account no longer has one: the caller draws the
        // initial. A missing face is a normal state, not an error banner.
        return null;
      }
    });

/// A person's face, or an elegant initial when there is none.
///
/// Nothing here asks the network unless the caller says the person *has* a
/// photo: a list of forty users with no photos must not fire forty requests
/// that all answer 404.
class UserAvatar extends ConsumerWidget {
  const UserAvatar({
    super.key,
    required this.userId,
    required this.name,
    this.hasPhoto = false,
    this.size = 34,
    this.ring = false,
  });

  final String userId;
  final String name;

  /// Whether the API says this account has a picture. When false the initial
  /// is drawn and no request is made.
  final bool hasPhoto;

  final double size;

  /// A hairline ring, for a photo sitting on a coloured surface (the sidebar,
  /// a section header) where a light face would otherwise bleed into it.
  final bool ring;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final fallback = _InitialAvatar(name: name, size: size);

    if (!hasPhoto || userId.isEmpty) return _decorate(fallback);

    final bytes = ref.watch(avatarBytesProvider(userId));
    return _decorate(ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: bytes.when(
          // While the image loads, the initial is shown - not a spinner: a
          // 20-pixel photo is not worth a progress indicator, and a flickering
          // circle is worse than a stable letter.
          loading: () => fallback,
          error: (_, _) => fallback,
          data: (data) {
            if (data == null || data.isEmpty) return fallback;
            return Image.memory(
              data,
              width: size,
              height: size,
              fit: BoxFit.cover,
              gaplessPlayback: true,
              // The bytes were validated by the server; decoding them at the
              // size they are drawn keeps memory low in a long list.
              cacheWidth: (size * 2).round(),
              errorBuilder: (_, _, _) => fallback,
            );
          },
        ),
      ),
    ));
  }

  /// The decorative ring is drawn outside the clip so the photo itself is not
  /// cropped by it.
  Widget _decorate(Widget child) {
    if (!ring) return child;
    return Container(
      padding: const EdgeInsets.all(1.5),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.onSidebar.withValues(alpha: 0.45)),
      ),
      child: child,
    );
  }
}

/// The letter that stands in for a photo.
///
/// Deliberately not a silhouette icon: at 24-40 pixels a grey person shape is
/// indistinguishable from a broken image, while the person's own initial reads
/// as "this is Amal" - and it is what the brief asked for.
class _InitialAvatar extends StatelessWidget {
  const _InitialAvatar({required this.name, required this.size});

  final String name;
  final double size;

  /// The first letter or digit of the name, in whichever script it is written.
  static String initialOf(String name) {
    for (final rune in name.runes) {
      final char = String.fromCharCode(rune);
      if (!_blank.hasMatch(char)) return char.toUpperCase();
    }
    return '?';
  }

  static final _blank = RegExp(r'[\s\-\u00A0\u200B-\u200D\uFEFF]');

  @override
  Widget build(BuildContext context) {
    // A stable hue per person: two colleagues in a list must not both be the
    // same anonymous grey, and the colour must not change between rebuilds.
    final hue = (name.runes.fold<int>(0, (sum, r) => (sum * 31 + r) & 0x7fffffff)) %
        6;
    final backgrounds = <Color>[
      const Color(0xFF2563EB),
      const Color(0xFF0B7A70),
      const Color(0xFF6D28D9),
      const Color(0xFFB23E0A),
      const Color(0xFF046C4E),
      const Color(0xFF1E3A8A),
    ];
    final background = backgrounds[hue];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Text(
        initialOf(name),
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.42,
          fontWeight: FontWeight.w600,
          height: 1,
        ),
      ),
    );
  }
}
