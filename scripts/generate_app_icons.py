#!/usr/bin/env python3
"""Generate KAYAN ERP platform icons from the repository's approved 1.png logo.

Requires Pillow: python -m pip install Pillow
Run before building the web app or desktop installers.
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "1.png"


def square(size: int) -> Image.Image:
    with Image.open(SOURCE) as source:
        image = source.convert("RGBA")
        # Preserve the full logo on a clean square canvas rather than cropping
        # text or marks from the uploaded artwork.
        fitted = ImageOps.contain(image, (size, size), method=Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
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
