"""Make the browser-tab and home-screen icons from the D&N logo.

    python tools/make_icons.py [--color "#202845"] [--background "#FFB892,#FA9F95,#CF9096"] [--tab-color "#8A8A8A"]

--background takes one color, or several separated by commas for a top-to-bottom
gradient. The default is the light part of the pink sunset (backgrounds/DSC_3651_1.JPG):
peach, coral, dusky pink, with a navy logo (the navy of that sunset's clouds).
Full sunset, white logo:  --color "#FFFFFF" --background "#F89D93,#B98A9C,#5E5A80,#2B3455"
Plain light version:      --color "#17261F" --background "#EEF0EA"

Reads branding/DannaNeil-logo-gray.png (left grey, never changed) and writes
recolored copies to web/public/icons/:
  dn-favicon-64.png        browser tab: logo only, transparent (--tab-color)
  dn-icon-192.png / -512   home screen: logo (--color) on --background
  dn-icon-maskable-512.png Android adaptive icon: same, with extra margin
  dn-apple-touch-180.png   iPhone / iPad home screen

Run it again with other colors whenever you like, then rebuild the site.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding" / "DannaNeil-logo-gray.png"
OUT = ROOT / "web" / "public" / "icons"


def logo_shape() -> Image.Image:
    """The logo's outline (alpha channel), trimmed to its edges."""
    alpha = Image.open(SOURCE).convert("RGBA").getchannel("A")
    return alpha.crop(alpha.point(lambda v: 255 if v > 8 else 0).getbbox())


def backdrop(size: int, background: str) -> Image.Image:
    """One color, or a top-to-bottom gradient through comma-separated colors."""
    stops = [ImageColor.getrgb(c.strip())[:3] for c in background.split(",")]
    if len(stops) == 1:
        return Image.new("RGBA", (size, size), (*stops[0], 255))
    canvas = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(canvas)
    for y in range(size):
        t = y / (size - 1) * (len(stops) - 1)
        i = min(int(t), len(stops) - 2)
        f = t - i
        rgb = tuple(round(a + (b - a) * f) for a, b in zip(stops[i], stops[i + 1]))
        draw.line([(0, y), (size, y)], fill=(*rgb, 255))
    return canvas


def icon(shape: Image.Image, size: int, color: str, background: str | None, fill: float) -> Image.Image:
    """Logo in `color`, scaled to `fill` of the icon, centered on `background` (None = transparent)."""
    scale = fill * size / max(shape.size)
    mask = shape.resize((round(shape.width * scale), round(shape.height * scale)), Image.LANCZOS)
    rgb = ImageColor.getrgb(color)[:3]
    canvas = backdrop(size, background) if background else Image.new("RGBA", (size, size), (*rgb, 0))
    ink = Image.new("RGBA", mask.size, (*rgb, 255))
    canvas.paste(ink, ((size - mask.width) // 2, (size - mask.height) // 2), mask)
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--color", default="#202845", help="logo color on the home-screen icons")
    ap.add_argument("--background", default="#FFB892,#FA9F95,#CF9096",
                    help="background of the home-screen icons: one color, or a comma-separated gradient (top to bottom)")
    ap.add_argument("--tab-color", default="#8A8A8A", help="logo color in the browser tab (grey shows on light and dark tabs)")
    args = ap.parse_args()

    shape = logo_shape()
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "dn-favicon-64.png": icon(shape, 64, args.tab_color, None, 0.98),
        "dn-icon-192.png": icon(shape, 192, args.color, args.background, 0.80),
        "dn-icon-512.png": icon(shape, 512, args.color, args.background, 0.80),
        "dn-icon-maskable-512.png": icon(shape, 512, args.color, args.background, 0.62),
        "dn-apple-touch-180.png": icon(shape, 180, args.color, args.background, 0.78),
    }
    for name, img in files.items():
        if name != "dn-favicon-64.png":
            img = img.convert("RGB")  # home-screen icons must be opaque
        img.save(OUT / name, optimize=True)
        print("wrote", (OUT / name).relative_to(ROOT))


if __name__ == "__main__":
    main()
