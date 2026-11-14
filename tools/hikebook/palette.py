"""Pick a small color palette from a photo, so the website can match it.

Returns {"light": {...}, "dark": {...}}, each with hex colors:
    paper   – the glass sheet (light tint, or deep shade in the dark theme)
    ink     – text and contrast color
    accent  – the photo's most vivid prominent color, adjusted to stay readable
    soft    – a muted mid-tone (thin rules, axes)
"""

from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image, ImageOps


def _hex(rgb: tuple[float, float, float]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*(max(0, min(255, round(c * 255))) for c in rgb))


def _hls(h: float, l: float, s: float) -> str:
    return _hex(colorsys.hls_to_rgb(h % 1.0, max(0.0, min(1.0, l)), max(0.0, min(1.0, s))))


def _hue_mean(colors: list[tuple[float, float, float, float]]) -> float:
    """Circular mean of hues weighted by weight*saturation. colors = (h, l, s, weight)."""
    import math
    x = sum(math.cos(2 * math.pi * h) * w * (s + 0.05) for h, l, s, w in colors)
    y = sum(math.sin(2 * math.pi * h) * w * (s + 0.05) for h, l, s, w in colors)
    return (math.atan2(y, x) / (2 * math.pi)) % 1.0


def palette_from_image(path: Path) -> dict:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((96, 96))
        quantized = im.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
        pal = quantized.getpalette()[: 8 * 3]
        counts = quantized.getcolors() or []

    total = sum(c for c, _ in counts) or 1
    swatches = []  # (h, l, s, share)
    for count, idx in counts:
        r, g, b = (pal[idx * 3 + k] / 255 for k in range(3))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        swatches.append((h, l, s, count / total))

    overall_hue = _hue_mean(swatches)
    overall_sat = min(sum(s * w for _, _, s, w in swatches), 0.6)

    # Hue of the darkest prominent swatch (for the deep shade)
    darkish = [sw for sw in swatches if sw[3] > 0.03] or swatches
    dh, dl, ds, _ = min(darkish, key=lambda sw: sw[1])
    deep_hue = dh if ds > 0.06 else overall_hue
    deep_sat = min(max(ds, 0.2), 0.5)

    # Most vivid color that covers a reasonable part of the photo
    vivid = [sw for sw in swatches if sw[3] > 0.025 and 0.15 < sw[1] < 0.85]
    if vivid:
        ah, _, as_, _ = max(vivid, key=lambda sw: sw[2] * (sw[3] ** 0.35))
    else:
        ah, as_ = overall_hue, overall_sat
    grey = as_ < 0.15
    accent_sat = min(max(as_, 0.5), 0.65)

    # Light theme: tinted light glass, dark text
    light_accent = "#C8102E" if grey else _hls(ah, 0.34 if 0.12 < ah < 0.36 else 0.44, accent_sat)
    light = {
        "paper": _hls(overall_hue, 0.89, 0.22 + 0.55 * overall_sat),
        "ink": _hls(deep_hue, 0.13, deep_sat),
        "accent": light_accent,
        "soft": _hls(overall_hue, 0.55, 0.2 + 0.35 * overall_sat),
    }

    # Dark theme: deep glass in the photo's shadow color, light text
    dark = {
        "paper": _hls(deep_hue, 0.15, deep_sat),
        "ink": _hls(overall_hue, 0.94, 0.25 + 0.3 * overall_sat),
        "accent": "#FF6B6B" if grey else _hls(ah, 0.68, accent_sat + 0.1),
        "soft": _hls(overall_hue, 0.5, 0.2 + 0.35 * overall_sat),
    }
    return {"light": light, "dark": dark}
