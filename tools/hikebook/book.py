"""Which book the tools work on: the public hiking book or the wedding book.

Set BOOK in the .env file at the top of the repo (BOOK=public or BOOK=wedding).
No .env = the public book. new_hike.py, build_hikes.py and fetch_osm.py all
use this, and web/vite.config.js reads the same file.

    public   hikes/          -> the public/demo book (GitHub Pages)
    wedding  wedding_hikes/  -> Danna & Neil's book (private, gitignored)

Building one book replaces the generated website data of the other.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"
BOOK_DIRS = {
    "public": ROOT / "hikes",
    "wedding": ROOT / "wedding_hikes",
}


def read_env(path: Path = ENV_FILE) -> dict[str, str]:
    """KEY=value lines of a .env file (# comments and blank lines skipped)."""
    if not path.exists():
        return {}
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


BOOK = read_env().get("BOOK", "public")
if BOOK not in BOOK_DIRS:
    raise ValueError(f'BOOK in .env must be one of {list(BOOK_DIRS)}, not "{BOOK}"')

HIKES_DIR = BOOK_DIRS[BOOK]


def id_taken(hike_id: str) -> bool:
    """True if any book already has a hike folder with this id (ids stay unique across books)."""
    return any((d / hike_id).exists() for d in BOOK_DIRS.values())
