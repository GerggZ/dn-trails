"""Start a new hike folder from a GPX file.

Set GPX_FILE below and run this file (or: python tools/new_hike.py path/to/Some_Hike.gpx).

Creates hikes/<id>/ where <id> is a short random code (e.g. "k29xq1"), with
track.gpx, an empty photos/ folder and an info.json pre-filled from the GPX
(title, date). Then drop your photos in photos/, fill in info.json, optionally
write the story in description.md, and run tools/build_hikes.py.
"""

from __future__ import annotations

import json
import secrets
import shutil
import string
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hikebook.gpx import read_gpx  # noqa: E402
from hikebook.metrics import start_date  # noqa: E402

# --- Settings ---
GPX_FILE = r""            # e.g. r"C:\Users\gregg\Downloads\Some_Hike.gpx"
OWNER = "gregg"           # a user id from users.json
PUBLIC = True             # False = only the owner and shared_with may see it (once logins exist)

HIKES_DIR = Path(__file__).resolve().parents[1] / "hikes"
ID_LENGTH = 6
ID_ALPHABET = string.ascii_lowercase + string.digits


def new_id() -> str:
    """A random id that isn't taken yet (and isn't all digits, so it never looks like a number)."""
    while True:
        hike_id = "".join(secrets.choice(ID_ALPHABET) for _ in range(ID_LENGTH))
        if not hike_id.isdigit() and not (HIKES_DIR / hike_id).exists():
            return hike_id


def main() -> None:
    gpx_file = sys.argv[1] if len(sys.argv) > 1 else GPX_FILE
    if not gpx_file:
        sys.exit("Set GPX_FILE at the top of new_hike.py first.")

    gpx_path = Path(gpx_file)
    gpx = read_gpx(gpx_path)
    folder = HIKES_DIR / new_id()

    (folder / "photos").mkdir(parents=True)
    (folder / "photos" / ".gitkeep").touch()  # keeps the empty folder in git (photos themselves are gitignored)
    shutil.copy2(gpx_path, folder / "track.gpx")

    info = {
        "title": gpx.name or "",
        "date": start_date(gpx.times) or "",
        "location": "",
        "owner": OWNER,
        "public": PUBLIC,
        "shared_with": [],
        "companions": [],
        "difficulty": "",
        "cover": "",
        "captions": {},
        "draft": False,
    }
    (folder / "info.json").write_text(json.dumps(info, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Created {folder}  ({info['title'] or 'untitled'})")


if __name__ == "__main__":
    main()
