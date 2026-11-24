"""Ground type along each trail, from OpenStreetMap.

    python tools/fetch_osm.py

For every hikes/<id>/ folder this asks OpenStreetMap (through the Overpass
API) which roads and paths lie under the trail. Each track point is matched
to the nearest mapped way within MATCH_RADIUS_M and labelled with one of the
three ground types the walking-time model knows (hikebook/timing.py):

    paved     asphalt, concrete, paving stones, ordinary streets
    path      tracks, trails, gravel, dirt, rock, ...
    offtrail  no mapped way nearby

The answer is saved in hikes/<id>/osm.json (small, fine to commit). That file
has one section per kind of OpenStreetMap data ("ground" for now), all tied
to the same track fingerprint ("track"), so more can be added later.
After that nothing needs the internet any more.

build_hikes.py calls this by itself for hikes that don't have that file yet
(or whose track.gpx changed), so normally you never run it by hand. Run it
yourself with REFRESH = True to pick up improvements made to OpenStreetMap.

Map data © OpenStreetMap contributors (ODbL).
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hikebook.gpx import read_gpx  # noqa: E402
from hikebook.metrics import cumulative_distance_km  # noqa: E402

# --- Settings when running this file directly ---
REFRESH = False        # True = ask OpenStreetMap again even if osm.json exists
ONLY_HIKES: list[str] = []  # hike ids (folder names), e.g. ["sgukal"]; empty = all hikes

ROOT = Path(__file__).resolve().parents[1]
HIKES_DIR = ROOT / "hikes"
CACHE_NAME = "osm.json"
OLD_CACHE_NAME = "osm_ground.json"  # name before Nov 2026; renamed automatically

# Public Overpass servers, tried in this order
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "DN-HikingBook/1.0 (personal hiking book; one query per hike)"

MATCH_RADIUS_M = 50.0   # same as the paper: further than this from any way = off-trail
BBOX_PAD_M = 120.0      # look a bit beyond the trail's bounding box
EARTH_RADIUS_M = 6371008.8

GROUND_TYPES = ("paved", "path", "offtrail")

# Ways that aren't real (yet / any more)
IGNORE_HIGHWAYS = {"proposed", "construction", "abandoned", "razed", "disused", "platform", "corridor", "elevator"}

PAVED_SURFACES = {
    "paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "chipseal",
    "paving_stones", "paving_stones:lanes", "sett", "cobblestone", "unhewn_cobblestone",
    "bricks", "metal", "metal_grid", "wood", "rubber", "tartan", "acrylic",
}
# Roads that are almost always paved when nobody tagged a surface
USUALLY_PAVED = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "living_street", "service", "pedestrian", "road", "busway", "cycleway",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}


class OsmError(RuntimeError):
    pass


def classify(tags: dict) -> str:
    """'paved' or 'path' for one OpenStreetMap way."""
    surface = tags.get("surface", "")
    if surface:
        return "paved" if surface in PAVED_SURFACES else "path"
    highway = tags.get("highway", "")
    if highway in USUALLY_PAVED:
        return "paved"
    if highway == "track":
        return "paved" if tags.get("tracktype") == "grade1" else "path"
    if highway == "footway" and tags.get("footway") in ("sidewalk", "crossing"):
        return "paved"
    return "path"  # path, footway, bridleway, steps, ... (trails)


def _bbox(lat: np.ndarray, lon: np.ndarray) -> tuple[float, float, float, float]:
    pad_lat = np.degrees(BBOX_PAD_M / EARTH_RADIUS_M)
    pad_lon = pad_lat / max(np.cos(np.radians(lat.mean())), 0.1)
    return (float(lat.min() - pad_lat), float(lon.min() - pad_lon),
            float(lat.max() + pad_lat), float(lon.max() + pad_lon))


def query_ways(lat: np.ndarray, lon: np.ndarray) -> list[dict]:
    """All mapped ways (roads, tracks, paths) in the trail's area, with tags and geometry."""
    s, w, n, e = _bbox(lat, lon)
    query = f'[out:json][timeout:120];way["highway"]({s:.6f},{w:.6f},{n:.6f},{e:.6f});out tags geom;'
    body = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for url in OVERPASS_URLS:
        request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
            return [el for el in data.get("elements", []) if el.get("type") == "way" and el.get("geometry")]
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            errors.append(f"{url}: {err}")
            time.sleep(2)
    raise OsmError("could not reach OpenStreetMap (" + "; ".join(errors) + ")")


def match_ground(lat: np.ndarray, lon: np.ndarray, ways: list[dict]) -> list[str]:
    """Ground type for every track point: that of the nearest way within MATCH_RADIUS_M."""
    lat0 = np.radians(lat.mean())

    def to_xy(la, lo):  # local flat coordinates in metres (plenty for a hike's area)
        return (np.radians(lo) * np.cos(lat0) * EARTH_RADIUS_M, np.radians(la) * EARTH_RADIUS_M)

    ax, ay, bx, by, kind = [], [], [], [], []
    for way in ways:
        tags = way.get("tags", {})
        if tags.get("highway") in IGNORE_HIGHWAYS:
            continue
        ground = GROUND_TYPES.index(classify(tags))
        g = way["geometry"]
        x, y = to_xy(np.array([p["lat"] for p in g]), np.array([p["lon"] for p in g]))
        if len(x) < 2:
            continue
        ax.append(x[:-1]); ay.append(y[:-1]); bx.append(x[1:]); by.append(y[1:])
        kind.append(np.full(len(x) - 1, ground))

    off = GROUND_TYPES.index("offtrail")
    if not ax:
        return ["offtrail"] * len(lat)
    ax, ay, bx, by, kind = map(np.concatenate, (ax, ay, bx, by, kind))
    dx, dy = bx - ax, by - ay
    len2 = np.maximum(dx * dx + dy * dy, 1e-9)

    px, py = to_xy(lat, lon)
    result = np.full(len(lat), off)
    for i in range(len(lat)):
        t = np.clip(((px[i] - ax) * dx + (py[i] - ay) * dy) / len2, 0.0, 1.0)
        d2 = (ax + t * dx - px[i]) ** 2 + (ay + t * dy - py[i]) ** 2
        j = int(np.argmin(d2))
        if d2[j] <= MATCH_RADIUS_M ** 2:
            result[i] = kind[j]
    return [GROUND_TYPES[k] for k in result]


def runs(ground: list[str]) -> list[list]:
    """["path","path","paved"] -> [[0,"path"],[2,"paved"]] (keeps the file small)."""
    return [[i, g] for i, g in enumerate(ground) if i == 0 or g != ground[i - 1]]


def _unruns(pairs: list[list], n: int) -> list[str]:
    out = []
    for k, (start, g) in enumerate(pairs):
        end = pairs[k + 1][0] if k + 1 < len(pairs) else n
        out.extend([g] * (end - start))
    return out


def _fingerprint(lat: np.ndarray, lon: np.ndarray) -> dict:
    """Enough to notice that track.gpx was replaced."""
    return {"points": int(len(lat)),
            "first": [round(float(lat[0]), 5), round(float(lon[0]), 5)],
            "last": [round(float(lat[-1]), 5), round(float(lon[-1]), 5)]}


def _read_cache(folder: Path) -> dict | None:
    path = folder / CACHE_NAME
    old = folder / OLD_CACHE_NAME
    if not path.exists() and old.exists():
        old.rename(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def load_cached(folder: Path, lat: np.ndarray, lon: np.ndarray) -> list[str] | None:
    cache = _read_cache(folder)
    if not cache or "ground" not in cache:
        return None
    if cache.get("track") != _fingerprint(lat, lon):
        return None  # track.gpx changed since
    return _unruns(cache["ground"], len(lat))


def fetch_and_save(folder: Path, lat: np.ndarray, lon: np.ndarray) -> list[str]:
    ground = match_ground(lat, lon, query_ways(lat, lon))
    track = _fingerprint(lat, lon)
    cache = _read_cache(folder) or {}
    if cache.get("track") != track:
        cache = {}  # other sections belong to an old track: drop them
    cache.update({
        "source": "© OpenStreetMap contributors (ODbL), via Overpass API",
        "fetched": date.today().isoformat(),
        "match_radius_m": MATCH_RADIUS_M,
        "track": track,
        "ground": runs(ground),
    })
    (folder / CACHE_NAME).write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    return ground


def ground_for_hike(folder: Path, lat: np.ndarray, lon: np.ndarray, refresh: bool = False) -> tuple[list[str] | None, str]:
    """Ground type per track point, plus a short note for the build log.

    Uses osm.json when it's there and still matches the track, otherwise
    asks OpenStreetMap. Returns (None, reason) if that fails.
    """
    if not refresh:
        cached = load_cached(folder, lat, lon)
        if cached is not None:
            return cached, "ground from osm.json"
    try:
        return fetch_and_save(folder, lat, lon), "ground fetched from OpenStreetMap"
    except OsmError as err:
        return None, str(err)


def summary_km(ground: list[str], dist_km: np.ndarray) -> dict:
    """km of each ground type, e.g. {'paved': 1.2, 'path': 10.4, 'offtrail': 0.3}."""
    seg = np.diff(dist_km)
    kinds = np.array(ground[:-1])
    return {g: round(float(seg[kinds == g].sum()), 2) for g in GROUND_TYPES}


def main() -> None:
    folders = sorted(p for p in HIKES_DIR.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")))
    if ONLY_HIKES:
        folders = [f for f in folders if f.name in ONLY_HIKES]
    for folder in folders:
        gpx_path = folder / "track.gpx"
        if not gpx_path.exists():
            gpx_path = next(iter(sorted(folder.glob("*.gpx"))), None)
        if gpx_path is None:
            print(f"- {folder.name}: no .gpx file, skipped")
            continue
        gpx = read_gpx(gpx_path)
        ground, note = ground_for_hike(folder, gpx.lat, gpx.lon, refresh=REFRESH)
        if ground is None:
            print(f"- {folder.name}: ! {note}")
            continue
        km = summary_km(ground, cumulative_distance_km(gpx.lat, gpx.lon))
        print(f"- {folder.name}: {note} – " + ", ".join(f"{g} {v} km" for g, v in km.items()))
        time.sleep(1)  # be gentle with the free Overpass servers


if __name__ == "__main__":
    main()
