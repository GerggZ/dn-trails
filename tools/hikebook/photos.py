"""Turn a hike's original photos into web-sized copies + thumbnails."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps

PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

FULL_SIZE_PX = 2000   # longest side of the lightbox / header image
THUMB_SIZE_PX = 800   # longest side of gallery/cover thumbnails
JPEG_QUALITY = 85


def list_photos(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(
        (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in PHOTO_EXTENSIONS),
        key=lambda p: p.name.lower(),
    )


def _resize(src: Path, dst: Path, size: int) -> tuple[int, int]:
    """Write a resized JPEG (skipped if it is already up to date). Returns (w, h)."""
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        with Image.open(dst) as done, Image.open(src) as orig:
            # Reuse it unless the target size changed since it was made
            if max(done.size) == min(size, max(orig.size)):
                return done.size
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)  # respect phone rotation
        im.thumbnail((size, size), Image.LANCZOS)
        if im.mode != "RGB":
            im = im.convert("RGB")
        im.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
        return im.size


def process_background(src: Path, out_dir: Path, url_prefix: str) -> dict:
    """A page background: one large JPEG, no thumbnail."""
    name = src.stem + ".jpg"
    w, h = _resize(src, out_dir / name, FULL_SIZE_PX)
    return {"file": src.name, "src": f"{url_prefix}/{name}", "width": w, "height": h}


def process_photo(src: Path, out_dir: Path, url_prefix: str) -> dict:
    """Make full + thumb versions of one photo. Returns the URLs (relative to the site root)."""
    name = src.stem + ".jpg"
    w, h = _resize(src, out_dir / name, FULL_SIZE_PX)
    _resize(src, out_dir / "thumbs" / name, THUMB_SIZE_PX)
    return {
        "file": src.name,
        "src": f"{url_prefix}/{name}",
        "thumb": f"{url_prefix}/thumbs/{name}",
        "width": w,
        "height": h,
    }
