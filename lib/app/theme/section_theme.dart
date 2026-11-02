import 'package:flutter/material.dart';

import 'design_tokens.dart';

/// The section a screen belongs to, made available to everything inside it.
///
/// The shell knows which module is open; the widgets further down (a page
/// header, a card, an empty state) need the same colour without every screen
/// having to be handed one. This inherited widget is that channel, so
/// «المشتريات» is orange on its canvas, its header rule and its figures without
/// a single screen repeating a hex value.
///
/// The fallback is the overview identity rather than null: a widget used
/// outside the shell (a widget test, a dialog preview) still renders in the
/// product's own colours instead of failing.
class SectionTheme extends InheritedWidget {
  const SectionTheme({super.key, required this.accent, required super.child});

  final SectionAccent accent;

  static SectionAccent of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<SectionTheme>();
    return scope?.accent ?? SectionAccents.overview;
  }

  /// The same lookup without subscribing: for a build method that reads it
  /// once and has already established its own dependency on the theme.
  static SectionAccent read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<SectionTheme>()?.accent ??
      SectionAccents.overview;

  @override
  bool updateShouldNotify(SectionTheme oldWidget) => oldWidget.accent != accent;
}

/// The painted canvas of one section.
///
/// A wash of the section's own colour, not a white page: this is what makes
/// «المخازن» and «المحاسبة» recognisably different places. The tint is chosen
/// so that both body inks keep at least 4.5:1 on it (pinned by the contrast
/// test), and the cards on top of it stay white - the colour is a background
/// for the workspace, never a place where a figure has to fight a gradient.
class SectionCanvas extends StatelessWidget {
  const SectionCanvas({super.key, required this.child, this.accent});

  final Widget child;

  /// Defaults to the section in scope.
  final SectionAccent? accent;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final identity = accent ?? SectionTheme.of(context);
    return DecoratedBox(
      // One flat tint. A gradient under tables would put the same number on
      // two different luminances across the page.
      decoration: BoxDecoration(color: identity.pageOf(brightness)),
      child: child,
    );
  }
}
