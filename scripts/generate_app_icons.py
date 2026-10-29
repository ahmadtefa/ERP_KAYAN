#!/usr/bin/env python3
"""Generate KAYAN ERP platform icons from the repository's approved 1.png logo.

Requires Pillow: python -m pip install Pillow
Run before building the web app or desktop installers.

The artwork in 1.png is the wide lockup (the KAYAN mark beside the words).
Shrinking the whole lockup into a square icon leaves the words as an
unreadable smear at taskbar and shortcut sizes, so the icons use the mark
on its own: the symbol is found as the artwork up to the first clear
vertical gap before the wordmark, then centred on the same clean square
canvas as before. If that shape is ever not found (a future logo without
the gap), the previous whole-lockup fit is used unchanged. The in-app
branding keeps using 1.png itself; only the platform icons change.
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "1.png"
CANVAS = (245, 247, 250, 255)


def _load() -> Image.Image:
    with Image.open(SOURCE) as source:
        return source.convert("RGBA")


def _symbol_box(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of the mark left of the wordmark, or None if unclear.

    Works on a downscaled copy of the alpha channel: the artwork is opaque
    blue on transparency, so a column belongs to the mark when any pixel in
    it is meaningfully opaque. The wordmark starts after the first vertical
    run of empty columns wide enough to be the gap between mark and words.
    """
    alpha = image.getchannel("A")
    scale = max(1, image.width // 1000)
    small = alpha.resize(
        (max(1, image.width // scale), max(1, image.height // scale))
    )
    pixels = small.load()
    width, height = small.size

    columns = [
        any(pixels[x, y] > 16 for y in range(height)) for x in range(width)
    ]
    try:
        first = columns.index(True)
    except ValueError:
        return None

    gap_min = max(6, width // 100)
    run = 0
    symbol_last = None
    for x in range(first, width):
        if columns[x]:
            run = 0
        else:
            run += 1
            if run >= gap_min:
                symbol_last = x - run
                break
    if symbol_last is None or symbol_last <= first:
        return None

    symbol_width = symbol_last - first + 1
    # The mark is roughly the first third of the lockup. Anything wildly
    # outside that means the artwork changed shape; fall back rather than
    # cropping the wrong thing.
    if not (0.15 * width <= symbol_width <= 0.55 * width):
        return None

    rows = [
        y
        for y in range(height)
        if any(pixels[x, y] > 16 for x in range(first, symbol_last + 1))
    ]
    if not rows:
        return None
    return (
        first * scale,
        rows[0] * scale,
        min(image.width, (symbol_last + 1) * scale),
        min(image.height, (rows[-1] + 1) * scale),
    )


def square(size: int) -> Image.Image:
    image = _load()
    box = _symbol_box(image)
    artwork = image.crop(box) if box is not None else image
    # Preserve the full mark on a clean square canvas rather than cropping
    # into it. A little breathing room keeps the mark clear of the edges
    # at small sizes.
    fit = max(1, round(size * 0.84))
    fitted = ImageOps.contain(artwork, (fit, fit), method=Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), CANVAS)
    canvas.alpha_composite(
        fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2)
    )
    return canvas


def save_png(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    square(size).save(path, format="PNG", optimize=True)


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Brand image not found: {SOURCE}")

    # Web favicon and installable PWA icons.
    save_png(ROOT / "web" / "favicon.png", 64)
    for size in (192, 512):
        save_png(ROOT / "web" / "icons" / f"Icon-{size}.png", size)
        save_png(ROOT / "web" / "icons" / f"Icon-maskable-{size}.png", size)

    # Android launcher icons at the platform's conventional densities.
    for density, size in {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }.items():
        save_png(ROOT / "android" / "app" / "src" / "main" / "res" / f"mipmap-{density}" / "ic_launcher.png", size)

    # Windows executable and installer icon. The ICO includes several sizes so
    # Explorer and shortcuts can select an appropriate resolution.
    windows_icon = ROOT / "windows" / "runner" / "resources" / "app_icon.ico"
    windows_icon.parent.mkdir(parents=True, exist_ok=True)
    square(256).save(
        windows_icon,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    print("Generated KAYAN ERP web, Android, and Windows icons from 1.png.")


if __name__ == "__main__":
    main()
