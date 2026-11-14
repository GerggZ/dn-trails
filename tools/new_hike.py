"""Start a new hike folder from a GPX file.

    python tools/new_hike.py path/to/Some_Hike.gpx [hike_id]

Creates hikes/<hike_id>/ with track.gpx, an empty photos/ folder and a
hike.json pre-filled from the GPX (title, date). Then drop your photos in
photos/, fill in hike.json and run tools/build_hikes.py.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hikebook.gpx import read_gpx  # noqa: E402
from hikebook.metrics import start_date  # noqa: E402

HIKES_DIR = Path(__file__).resolve().parents[1] / "hikes"


def slugify(text: str) -> str:
    text = text.replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "hike"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    gpx_path = Path(sys.argv[1])
    gpx = read_gpx(gpx_path)
    hike_id = sys.argv[2] if len(sys.argv) > 2 else slugify(gpx.name or gpx_path.stem)

    folder = HIKES_DIR / hike_id
    if folder.exists():
        sys.exit(f"{folder} already exists")

    (folder / "photos").mkdir(parents=True)
    shutil.copy2(gpx_path, folder / "track.gpx")

    info = {
        "title": gpx.name or "",
        "date": start_date(gpx.times) or "",
        "location": "",
        "description": "",
        "companions": [],
        "difficulty": "",
        "cover": "",
        "captions": {},
        "draft": False,
    }
    (folder / "hike.json").write_text(json.dumps(info, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Created {folder}")


if __name__ == "__main__":
    main()
