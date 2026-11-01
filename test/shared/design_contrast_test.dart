import 'dart:math' as math;

import 'package:erp_kayan/app/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Measured contrast for the colours that carry meaning.
///
/// A status pill's label is 10.5 pixels; WCAG calls that normal text and asks
/// for 4.5:1. The dashboard's meaning colours used to be the same step that
/// draws icons, which measured 4.15 (danger) to 4.42 (warning) on their own
/// chips - close enough to look fine and not close enough to read - and on the
/// dark canvas the same colours measured 2.8 to 3.4, where they vanish
/// altogether. The tokens now have a step for words and a step for the dark
/// canvas; this pins both so a later "nicer" shade cannot quietly undo it.
void main() {
  /// WCAG 2.1 relative luminance.
  double luminanceOf(Color color) {
    double channel(double value) => value <= 0.03928
        ? value / 12.92
        : math.pow((value + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(color.r) +
        0.7152 * channel(color.g) +
        0.0722 * channel(color.b);
  }

  double contrast(Color a, Color b) {
    final first = luminanceOf(a);
    final second = luminanceOf(b);
    final lighter = math.max(first, second);
    final darker = math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const smallText = 4.5;
  const graphicalObject = 3.0;

  final darkSurfaces = <String, Color>{
    'dark surface': AppColors.darkSurface,
    'dark surface alt': AppColors.darkSurfaceAlt,
  };
  final lightSurfaces = <String, Color>{
    'surface': AppColors.surface,
    'surface muted': AppColors.surfaceMuted,
  };

  for (final tone in AppTone.values) {
    group('${tone.name} tone', () {
      test('its words read on their own chip in the light theme', () {
        expect(
          contrast(tone.foreground, tone.background),
          greaterThanOrEqualTo(smallText),
          reason: '${tone.name} label on its soft chip',
        );
      });

      test('its words read straight on a light card', () {
        for (final entry in lightSurfaces.entries) {
          expect(
            contrast(tone.foreground, entry.value),
            greaterThanOrEqualTo(smallText),
            reason: '${tone.name} on ${entry.key}',
          );
        }
      });

      test('its words read on its own chip in the dark theme', () {
        for (final entry in darkSurfaces.entries) {
          final chip = tone.backgroundOn(
            Brightness.dark,
            surface: entry.value,
          );
          expect(
            contrast(tone.foregroundOn(Brightness.dark), chip),
            greaterThanOrEqualTo(smallText),
            reason: '${tone.name} label on its chip over ${entry.key}',
          );
        }
      });

      test('its words read straight on a dark card', () {
        for (final entry in darkSurfaces.entries) {
          expect(
            contrast(tone.foregroundOn(Brightness.dark), entry.value),
            greaterThanOrEqualTo(smallText),
            reason: '${tone.name} on ${entry.key}',
          );
        }
      });

      test('the light theme keeps its chip for both brightnesses', () {
        expect(
          tone.backgroundOn(Brightness.light),
          tone.background,
          reason: 'a light build must not change',
        );
        expect(tone.foregroundOn(Brightness.light), tone.foreground);
      });
    });
  }

  // One entry per identity colour the owner named: customers (turquoise) and
  // suppliers (violet) are two colours, not one "parties" colour, because a
  // payment to a supplier must never look like one from a customer.
  const accents = <String, SectionAccent>{
    'overview': SectionAccents.overview,
    'accounting': SectionAccents.accounting,
    'cash': SectionAccents.cash,
    'customers': SectionAccents.customers,
    'suppliers': SectionAccents.suppliers,
    'inventory': SectionAccents.inventory,
    'sales': SectionAccents.sales,
    'purchases': SectionAccents.purchases,
    'insights': SectionAccents.insights,
    'administration': SectionAccents.administration,
  };

  group('section colours', () {
    test('read as icons on their tinted tile in the light theme', () {
      for (final entry in accents.entries) {
        final accent = entry.value;
        expect(
          contrast(accent.of(Brightness.light), accent.softOf(Brightness.light)),
          greaterThanOrEqualTo(graphicalObject),
          reason: '${entry.key} icon tile',
        );
      }
    });

    test('read as text on a light card', () {
      for (final entry in accents.entries) {
        expect(
          contrast(entry.value.of(Brightness.light), AppColors.surface),
          greaterThanOrEqualTo(smallText),
          reason: '${entry.key} on white',
        );
      }
    });

    test('read as icons on their tinted tile in the dark theme', () {
      for (final entry in accents.entries) {
        final accent = entry.value;
        for (final surface in darkSurfaces.values) {
          final tile = Color.alphaBlend(
            accent.softOf(Brightness.dark),
            surface,
          );
          expect(
            contrast(accent.of(Brightness.dark), tile),
            greaterThanOrEqualTo(graphicalObject),
            reason: '${entry.key} icon tile',
          );
        }
      }
    });

    test('read as text on a dark card', () {
      for (final entry in accents.entries) {
        for (final surface in darkSurfaces.values) {
          expect(
            contrast(entry.value.of(Brightness.dark), surface),
            greaterThanOrEqualTo(smallText),
            reason: '${entry.key} on a dark card',
          );
        }
      }
    });

    // The brief asks for a distinct light background per section. A tint that
    // makes the ordinary text on it harder to read is not a design, it is a
    // regression, so both the body ink and the section's own ink are measured
    // on the tinted canvas and on the tinted panel.
    test('keep ordinary text readable on their tinted canvas', () {
      for (final entry in accents.entries) {
        final accent = entry.value;
        for (final ink in <String, Color>{
          'body ink': AppColors.textPrimary,
          'secondary ink': AppColors.textSecondary,
          'section ink': accent.base,
        }.entries) {
          expect(
            contrast(ink.value, accent.pageTint),
            greaterThanOrEqualTo(smallText),
            reason: '${entry.key}: ${ink.key} on its page tint',
          );
          expect(
            contrast(ink.value, accent.panelTint),
            greaterThanOrEqualTo(smallText),
            reason: '${entry.key}: ${ink.key} on its panel tint',
          );
        }
      }
    });

    test('are visibly different from one another, not five shades of blue', () {
      // Two sections that measure as the same colour on screen are two
      // sections a person cannot tell apart at a glance, which is the whole
      // point of the palette.
      final entries = accents.entries.toList();
      for (var i = 0; i < entries.length; i += 1) {
        for (var j = i + 1; j < entries.length; j += 1) {
          final a = entries[i].value.pageTint;
          final b = entries[j].value.pageTint;
          final delta = (a.r - b.r).abs() + (a.g - b.g).abs() + (a.b - b.b).abs();
          expect(
            delta,
            greaterThan(0.01),
            reason: '${entries[i].key} and ${entries[j].key} share a canvas',
          );
        }
      }
    });

    test('the sidebar still reads at its own weights', () {
      // The identity colours are also used as the selected item's marker on
      // the navy sidebar; a marker nobody can see is not a marker.
      for (final entry in accents.entries) {
        expect(
          contrast(entry.value.base, AppColors.navy),
          greaterThanOrEqualTo(2.5),
          reason: '${entry.key} marker on the sidebar',
        );
      }
    });
  });

  group('the navy frame', () {
    final navies = <String, Color>{
      'navy': AppColors.navy,
      'navy deep': AppColors.navyDeep,
      'navy soft': AppColors.navySoft,
    };

    test('ordinary sidebar words read', () {
      for (final entry in navies.entries) {
        expect(
          contrast(AppColors.onSidebar, entry.value),
          greaterThanOrEqualTo(smallText),
          reason: 'sidebar text on ${entry.key}',
        );
        expect(
          contrast(AppColors.onSidebarMuted, entry.value),
          greaterThanOrEqualTo(smallText),
          reason: 'sidebar section label on ${entry.key}',
        );
      }
    });

    test('so does the section colour of the selected entry', () {
      for (final entry in accents.entries) {
        for (final navy in navies.entries) {
          expect(
            contrast(entry.value.darkBase, navy.value),
            greaterThanOrEqualTo(smallText),
            reason: '${entry.key} selected label on ${navy.key}',
          );
        }
      }
    });
  });

  test('the primary button keeps readable words', () {
    expect(
      contrast(Colors.white, AppColors.primary),
      greaterThanOrEqualTo(smallText),
    );
  });

  test('the purchases bar is visible in both themes', () {
    expect(
      contrast(AppColors.chartPurchases, AppColors.surface),
      greaterThanOrEqualTo(graphicalObject),
    );
    expect(
      contrast(AppColors.chartPurchasesDark, AppColors.darkSurface),
      greaterThanOrEqualTo(graphicalObject),
    );
  });
}
