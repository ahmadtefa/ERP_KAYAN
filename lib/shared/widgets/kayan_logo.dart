import 'package:flutter/material.dart';

/// The KAYAN lockup, exactly as it was drawn.
///
/// The file is `1.png` — the owner's original artwork, 3816 × 1221 with a real
/// alpha channel (72% of its pixels are fully transparent). It is shown from
/// that file and never redrawn, recoloured or re-exported: a logo that is
/// regenerated is no longer the company's logo.
///
/// What went wrong before was the frame, not the file. The mark used to be
/// placed inside a white, padded, rounded container with its own border and
/// shadow — a white plate behind a transparent PNG, which is exactly the
/// "logo with a background" the owner reported — and it was forced into a
/// 34 × 34 square although the artwork is 3.13 : 1, so the wordmark was
/// squeezed to illegibility.
///
/// This widget therefore paints the image and nothing else:
///
///  * no container colour, no padding plate, no border, no shadow behind it;
///  * the natural aspect ratio is kept and only the *height* is chosen, so it
///    cannot be stretched;
///  * it is painted at a high filter quality because the artwork is a large
///    bitmap being shown small;
///  * on a dark surface it is still the same file — the mark is blue-on-
///    transparent and reads on both, which is what "supports light and dark
///    backgrounds" means for this artwork. No lightening filter, tint or
///    backdrop is applied.
///
/// `test/shared/logo_transparency_test.dart` proves both halves of that: the
/// asset really carries alpha (decoded, not assumed from the extension), and
/// no ancestor inside this widget paints an opaque plate behind it.
class KayanLogo extends StatelessWidget {
  const KayanLogo({
    super.key,
    this.height = 30,
    this.alignment = AlignmentDirectional.centerStart,
    this.semanticLabel = 'KAYAN ERP',
  });

  /// Height in logical pixels. The width follows from the artwork's own
  /// 3816 : 1221 shape, so the lockup can never be distorted.
  final double height;

  final AlignmentGeometry alignment;

  /// Names the mark for screen readers; the artwork carries the word, but an
  /// image without a label is an unreadable gap in a screen reader.
  final String semanticLabel;

  /// The artwork's real proportions, exposed so a caller can reserve the right
  /// width instead of guessing (a 34-pixel square is what broke it before).
  static const double aspectRatio = 3816 / 1221;

  static double widthFor(double height) => height * aspectRatio;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticLabel,
      image: true,
      child: Image.asset(
        '1.png',
        height: height,
        // Width is derived, not given: giving both would let the box disagree
        // with the artwork and squash it.
        fit: BoxFit.contain,
        alignment: alignment,
        filterQuality: FilterQuality.high,
        // The pixels are transparent where they should be; nothing is painted
        // behind them here, on any surface.
        isAntiAlias: true,
        excludeFromSemantics: true,
        gaplessPlayback: true,
        errorBuilder: (context, error, stack) => SizedBox(
          height: height,
          width: widthFor(height),
          child: Center(
            child: Text(
              'KAYAN',
              style: TextStyle(
                fontSize: height * 0.42,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
                color: DefaultTextStyle.of(context).style.color,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
