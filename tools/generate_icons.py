#!/usr/bin/env python3
"""Regenerates every icon the program ships from one source image.

The one source is ``Kayan.png`` at the repository root — the KAYAN logo,
exactly as it is. Nothing here redraws, recolors or replaces it: each icon is
the logo, unmodified, fitted into the square canvas an icon format needs.

Composition, chosen to keep the original design intact:

  * the logo's own background is white, so the square canvas is white too —
    the artwork blends into its canvas with no cropped edges and no invented
    transparency (the source PNG is opaque RGB; its pixels are never altered);
  * the logo is fitted whole (width-limited, since it is a wide mark) and
    centred with a margin — never cropped;
  * maskable PWA icons keep the same white canvas but fit the logo inside the
    80% central safe zone, so launcher masking never cuts the mark.

Outputs (all paths relative to the repository root):

  windows/runner/resources/app_icon.ico   multi-size 16..256 — the exe icon
                                          AND the window icon (Runner.rc
                                          embeds this file as IDI_APP_ICON)
  web/favicon.png                         32x32 — the browser tab
  web/icons/Icon-192.png                  PWA + apple-touch-icon
  web/icons/Icon-512.png                  PWA splash/install
  web/icons/Icon-maskable-192.png         masked launchers
  web/icons/Icon-maskable-512.png         masked launchers

Usage (needs Pillow: ``pip install Pillow``):

    python3 tools/generate_icons.py

Run it again whenever Kayan.png changes; then rebuild so the new icons travel
into the packages (flutter build web copies web/ as is; the Windows exe
embeds app_icon.ico at compile time).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Kayan.png"

WHITE = (255, 255, 255)
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def square_icon(logo: Image.Image, size: int, *, margin: float) -> Image.Image:
    """The logo, whole and unmodified, centred on a white square."""
    canvas = Image.new("RGB", (size, size), WHITE)
    box = int(size * (1 - 2 * margin))
    # The logo is wide, so the width binds; keep its aspect ratio exactly.
    scale = min(box / logo.width, box / logo.height)
    fitted = logo.resize(
        (max(1, round(logo.width * scale)), max(1, round(logo.height * scale))),
        Image.LANCZOS,
    )
    canvas.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def main() -> int:
    if not SOURCE.exists():
        sys.exit(f"missing source image: {SOURCE}")
    logo = Image.open(SOURCE).convert("RGB")

    # Windows: one .ico carrying every size the shell asks for.
    ico_path = ROOT / "windows" / "runner" / "resources" / "app_icon.ico"
    big = square_icon(logo, 256, margin=0.06)
    big.save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote {ico_path.relative_to(ROOT)}  sizes={ICO_SIZES}")

    # Web: favicon + PWA icons (plain and maskable).
    web_jobs = [
        ("web/favicon.png", 32, 0.04),
        ("web/icons/Icon-192.png", 192, 0.06),
        ("web/icons/Icon-512.png", 512, 0.06),
        # Maskable: the mark stays inside the 80% circle launchers keep.
        ("web/icons/Icon-maskable-192.png", 192, 0.18),
        ("web/icons/Icon-maskable-512.png", 512, 0.18),
    ]
    for rel, size, margin in web_jobs:
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        square_icon(logo, size, margin=margin).save(path, format="PNG")
        print(f"wrote {rel}  {size}x{size}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
