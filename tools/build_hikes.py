"""Build the website data from the hikes/ folder.

    python tools/build_hikes.py

For every hikes/<id>/ folder (track.gpx + hike.json + photos/) this writes:
    web/public/data/hikes/<id>.json   full track, stats, waypoints, photos
    web/public/data/hikes.json        the list shown on the index page
    web/public/photos/<id>/           web-sized photos and thumbnails

The walking-time estimate needs the ground type along the trail, which comes
from OpenStreetMap (see fetch_osm.py). It's fetched once per hike and saved as
hikes/<id>/osm_ground.json; without internet the build still works and
counts everything as "path".

and for the photos in backgrounds/ (the blurred page backgrounds):
    web/public/backgrounds/            resized copies
    web/public/data/backgrounds.json   the list the website picks from

Everything under web/public/data and web/public/photos is generated:
don't edit it by hand, just rerun this script.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hikebook.gpx import read_gpx  # noqa: E402
from hikebook import metrics, timing  # noqa: E402
import fetch_osm  # noqa: E402
from hikebook.photos import list_photos, process_background, process_photo  # noqa: E402
from hikebook.palette import palette_from_image  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
HIKES_DIR = ROOT / "hikes"
BACKGROUNDS_DIR = ROOT / "backgrounds"
PUBLIC_DIR = ROOT / "web" / "public"
DATA_DIR = PUBLIC_DIR / "data"
PHOTOS_DIR = PUBLIC_DIR / "photos"
BACKGROUNDS_OUT = PUBLIC_DIR / "backgrounds"

# Ask OpenStreetMap for hikes that don't have osm_ground.json yet
# (False = never go online; missing ground types then count as "path")
FETCH_OSM = True

HIKE_DEFAULTS = {
    "title": "",
    "date": "",
    "location": "",
    "description": "",
    "companions": [],
    "difficulty": "",
    "cover": "",
    "captions": {},
    "draft": False,
    # Ground for the walking-time estimate: "auto" (from OpenStreetMap),
    # or force one for the whole hike: "paved", "path" or "offtrail"
    "ground": "auto",
}


def warn(hike_id: str, message: str) -> None:
    print(f"  ! {hike_id}: {message}")


def find_gpx(folder: Path) -> Path | None:
    preferred = folder / "track.gpx"
    if preferred.exists():
        return preferred
    gpx_files = sorted(folder.glob("*.gpx"))
    return gpx_files[0] if gpx_files else None


def load_info(folder: Path) -> dict:
    info_path = folder / "hike.json"
    info = dict(HIKE_DEFAULTS)
    if info_path.exists():
        info.update(json.loads(info_path.read_text(encoding="utf-8")))
    return info


def build_hike(folder: Path) -> dict | None:
    hike_id = folder.name
    info = load_info(folder)
    if info.get("draft"):
        print(f"- {hike_id} (draft, skipped)")
        return None

    gpx_path = find_gpx(folder)
    if gpx_path is None:
        warn(hike_id, "no .gpx file, skipped")
        return None

    print(f"- {hike_id}")
    gpx = read_gpx(gpx_path)

    dist_km = metrics.cumulative_distance_km(gpx.lat, gpx.lon)
    ascent, descent = metrics.ascent_descent_m(gpx.ele_m)
    grade = metrics.grade_percent(dist_km, gpx.ele_m)
    ground = ground_types(folder, info, gpx)
    time_s = timing.walking_time_s(dist_km, grade, ground)
    km = fetch_osm.summary_km(ground, dist_km)
    print(f"    walking time ≈ {time_s[-1] / 3600:.1f} h  ("
          + ", ".join(f"{g} {v} km" for g, v in km.items() if v) + ")")

    waypoints = []
    for wp in gpx.waypoints:
        i = metrics.nearest_index(gpx.lat, gpx.lon, wp.lat, wp.lon)
        waypoints.append(
            {
                "name": wp.name,
                "description": wp.description,
                "lat": round(wp.lat, 6),
                "lon": round(wp.lon, 6),
                "index": i,  # closest track point, used to snap it onto the profile
            }
        )
    waypoints.sort(key=lambda w: w["index"])

    # --- photos ---
    captions: dict = info.get("captions") or {}
    photo_files = list_photos(folder / "photos")
    out_dir = PHOTOS_DIR / hike_id
    photos = []
    for src in photo_files:
        entry = process_photo(src, out_dir, f"photos/{hike_id}")
        entry["caption"] = captions.get(src.name, "")
        photos.append(entry)

    known = {p.name for p in photo_files}
    for name in captions:
        if name not in known:
            warn(hike_id, f"caption for '{name}' but no such file in photos/")

    cover = None
    if info.get("cover"):
        cover = next((p for p in photos if p["file"] == info["cover"]), None)
        if cover is None:
            warn(hike_id, f"cover '{info['cover']}' not found in photos/")
    # No "cover" chosen in hike.json -> no main photo; the website draws a landscape instead

    stats = {
        "distance_km": round(float(dist_km[-1]), 2),
        "ascent_m": round(ascent),
        "descent_m": round(descent),
        "max_elevation_m": round(float(gpx.ele_m.max())),
        "min_elevation_m": round(float(gpx.ele_m.min())),
        # Clock time of the recorded GPX, breaks and nights included (not shown any more)
        "duration_h": (round(d, 2) if (d := metrics.duration_hours(gpx.times)) else None),
        # Estimated moving time for an average hiker (hikebook/timing.py)
        "walking_time_h": round(float(time_s[-1]) / 3600, 2),
        "ground_km": km,
    }

    hike = {
        "id": hike_id,
        "title": info["title"] or gpx.name or hike_id.replace("_", " ").title(),
        "date": info["date"] or metrics.start_date(gpx.times) or "",
        "location": info["location"],
        "description": info["description"] or gpx.description or "",
        "companions": info["companions"],
        "difficulty": info["difficulty"],
        "stats": stats,
        "cover": cover["thumb"] if cover else None,
        "cover_src": cover["src"] if cover else None,
        # Colors picked from the cover photo, so the page can match it
        "palette": palette_from_image(folder / "photos" / cover["file"]) if cover else None,
        "profile": profile_points(dist_km, gpx.ele_m),
        "bbox": metrics.bbox(gpx.lat, gpx.lon),
        # A light copy of the trail for the map on the index page: [[lat, lon], ...]
        "line": line_points(gpx.lat, gpx.lon),
        "waypoints": waypoints,
        "photos": photos,
        "track": {
            "lat": np.round(gpx.lat, 6).tolist(),
            "lon": np.round(gpx.lon, 6).tolist(),
            "ele_m": np.round(gpx.ele_m, 1).tolist(),
            "dist_km": np.round(dist_km, 4).tolist(),
            "grade_pct": np.round(grade, 1).tolist(),
            # Model walking time from the start to each point (seconds, average walker)
            "time_s": np.round(time_s).astype(int).tolist(),
            # For the pace slider (web/src/lib/walking-time.js): slope of each stretch
            # between two points (degrees), and the ground as [[first point, type], ...]
            "slope_deg": np.round(timing.segment_slopes_deg(grade), 1).tolist(),
            "ground": fetch_osm.runs(ground),
        },
    }

    write_json(DATA_DIR / "hikes" / f"{hike_id}.json", hike)
    return hike


def ground_types(folder: Path, info: dict, gpx) -> list[str]:
    """Ground type per track point: forced in hike.json, from OpenStreetMap, or "path"."""
    n = len(gpx.lat)
    forced = info.get("ground") or "auto"
    if forced in timing.COEFFICIENTS:
        return [forced] * n
    if forced != "auto":
        warn(folder.name, f'unknown "ground": "{forced}" (use auto, paved, path or offtrail)')

    cached = fetch_osm.load_cached(folder, gpx.lat, gpx.lon)
    if cached is not None:
        return cached
    if not FETCH_OSM:
        return ["path"] * n
    ground, note = fetch_osm.ground_for_hike(folder, gpx.lat, gpx.lon)
    if ground is None:
        warn(folder.name, f"{note} – counting everything as path for now")
        return ["path"] * n
    print(f"    {note}")
    return ground


def profile_points(dist_km: np.ndarray, ele_m: np.ndarray, n: int = 72) -> list[float]:
    """A small, evenly spaced elevation profile (m) for the index-card silhouettes."""
    xs = np.linspace(0, dist_km[-1], n)
    return np.round(np.interp(xs, dist_km, ele_m)).tolist()


def line_points(lat: np.ndarray, lon: np.ndarray, n: int = 160) -> list[list[float]]:
    """Every k-th track point (always incl. the last one), about n in all, rounded to ~1 m."""
    idx = np.unique(np.append(np.linspace(0, len(lat) - 1, min(n, len(lat))).round().astype(int), len(lat) - 1))
    return [[round(float(lat[i]), 5), round(float(lon[i]), 5)] for i in idx]


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_backgrounds() -> None:
    sources = list_photos(BACKGROUNDS_DIR)
    backgrounds = [
        {**process_background(src, BACKGROUNDS_OUT, "backgrounds"), "palette": palette_from_image(src)}
        for src in sources
    ]
    keep = {b["src"].split("/")[-1] for b in backgrounds}
    if BACKGROUNDS_OUT.is_dir():
        for stale in BACKGROUNDS_OUT.iterdir():
            if stale.is_file() and stale.name not in keep:
                stale.unlink()
    write_json(DATA_DIR / "backgrounds.json", backgrounds)
    print(f"Prepared {len(backgrounds)} background photo(s)")


def main() -> None:
    if not HIKES_DIR.is_dir():
        sys.exit(f"No hikes folder at {HIKES_DIR}")

    folders = sorted(p for p in HIKES_DIR.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")))
    hikes = [h for f in folders if (h := build_hike(f))]

    # Remove generated files of hikes that were deleted/renamed/drafted
    live = {h["id"] for h in hikes}
    for stale in (DATA_DIR / "hikes").glob("*.json"):
        if stale.stem not in live:
            stale.unlink()
    if PHOTOS_DIR.is_dir():
        for stale in PHOTOS_DIR.iterdir():
            if stale.is_dir() and stale.name not in live:
                shutil.rmtree(stale)

    index = [
        {k: h[k] for k in ("id", "title", "date", "location", "difficulty", "cover", "cover_src", "bbox", "stats", "profile", "line")}
        for h in sorted(hikes, key=lambda h: h["date"] or "", reverse=True)
    ]
    write_json(DATA_DIR / "hikes.json", index)
    build_backgrounds()
    print(f"\nBuilt {len(hikes)} hike(s) -> {DATA_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
