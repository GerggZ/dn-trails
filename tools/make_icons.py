"""Make the browser-tab and home-screen icons, and the site-bar logo, for both books.

Set the colors below and run this file, then rebuild the site.

For each logo in LOGOS it reads branding/<name>.png (left grey, never changed)
and branding/<name>.svg, and writes to web/public/icons/:
  <prefix>-favicon-64.png        browser tab: logo only, transparent (TAB_COLOR)
  <prefix>-icon-192.png / -512   home screen: logo (COLOR) on BACKGROUND
  <prefix>-icon-maskable-512.png Android adaptive icon: same, with extra margin
  <prefix>-apple-touch-180.png   iPhone / iPad home screen
  <prefix>-logo.svg              the logo in the site bar (SITE_BAR_COLOR)

Which book uses which prefix: config.js editions (logo: 'hb' / 'dn').

Earlier color ideas:
  pink sunset:  COLOR "#202845", BACKGROUND "#FFB892,#FA9F95,#CF9096"
  full sunset:  COLOR "#FFFFFF", BACKGROUND "#F89D93,#B98A9C,#5E5A80,#2B3455"
  plain light:  COLOR "#17261F", BACKGROUND "#EEF0EA"
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

# --- Settings ---
LOGOS = {
    "hb": "generic-logo-gray",     # public hiking book
    "dn": "DannaNeil-logo-gray",   # Danna & Neil's wedding book
}
COLOR = "#2B3320"                          # logo on the home-screen icons (dark olive)
BACKGROUND = "#EEF0E2,#E3E6D2,#D3D8BE"     # one color, or a comma-separated gradient (top to bottom)
TAB_COLOR = "#8A8A8A"                      # browser tab (grey shows on light and dark tabs)
SITE_BAR_COLOR = "#292F14"                 # site-bar logo: the page's ink color

ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "branding"
OUT = ROOT / "web" / "public" / "icons"


def logo_shape(source: Path) -> Image.Image:
    """The logo's outline (alpha channel), trimmed to its edges."""
    alpha = Image.open(source).convert("RGBA").getchannel("A")
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


def site_bar_svg(source: Path, color: str) -> str:
    """The SVG logo recolored (its one fill on the <svg> element), title kept for screen readers."""
    text = source.read_text(encoding="utf-8")
    recolored, n = re.subn(r'(<svg\b[^>]*\bfill=")[^"]*(")', rf"\g<1>{color}\g<2>", text, count=1)
    if n != 1:
        raise ValueError(f"{source.name}: no fill=\"...\" on the <svg> element to recolor")
    return recolored


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for prefix, name in LOGOS.items():
        shape = logo_shape(BRANDING / f"{name}.png")
        files = {
            f"{prefix}-favicon-64.png": icon(shape, 64, TAB_COLOR, None, 0.98),
            f"{prefix}-icon-192.png": icon(shape, 192, COLOR, BACKGROUND, 0.80),
            f"{prefix}-icon-512.png": icon(shape, 512, COLOR, BACKGROUND, 0.80),
            f"{prefix}-icon-maskable-512.png": icon(shape, 512, COLOR, BACKGROUND, 0.62),
            f"{prefix}-apple-touch-180.png": icon(shape, 180, COLOR, BACKGROUND, 0.78),
        }
        for file, img in files.items():
            if "favicon" not in file:
                img = img.convert("RGB")  # home-screen icons must be opaque
            img.save(OUT / file, optimize=True)
            print("wrote", (OUT / file).relative_to(ROOT))
        svg = OUT / f"{prefix}-logo.svg"
        svg.write_text(site_bar_svg(BRANDING / f"{name}.svg", SITE_BAR_COLOR), encoding="utf-8", newline="\n")
        print("wrote", svg.relative_to(ROOT))


if __name__ == "__main__":
    main()
