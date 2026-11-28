"""Walking time along a trail (moving time, no breaks).

Model from Wood, Mackaness, Simpson & Armstrong (2023), "Improved prediction
of hiking speeds using a data driven approach", PLOS ONE 18(12): e0295848.
They fitted it to ~88,000 km of real GPS walks in the UK (breaks removed), and
it beat Naismith's rule, Tobler's hiking function and Campbell et al. there.

    speed (km/h) = exp(a + b * hill + c * slope + d * slope**2)

    slope  walking slope in degrees, positive = uphill
    hill   steepness of the hillside across the path, in degrees
    a..d   per ground type, Table 2 of the paper (below)

We don't know the hillside steepness (a GPX track is just a line), so `hill`
is 0. On trails that cut across a steep slope the time comes out a few
percent short; on valley floors and ridges it makes no difference.

The ground type per track point comes from OpenStreetMap (tools/fetch_osm.py);
without it everything counts as "path".
"""

from __future__ import annotations

import numpy as np

# (a, b, c, d) from Table 2. "offtrail" = the paper's off-road row with
# unknown vegetation (their vegetation heights come from UK-only lidar).
COEFFICIENTS = {
    "paved": (1.580, -0.00389, -0.00726, -0.00218),
    "path": (1.580, -0.00389, -0.00965, -0.00248),
    "offtrail": (1.536, -0.00731, -0.00965, -0.00187),
}

# GPS elevation glitches can make a few metres look like a cliff
MAX_SLOPE_DEG = 40.0


def speed_kmh(slope_deg: np.ndarray, ground: np.ndarray, hill_deg: float = 0.0) -> np.ndarray:
    a, b, c, d = (np.array([COEFFICIENTS[g][k] for g in ground]) for k in range(4))
    return np.exp(a + b * hill_deg + c * slope_deg + d * slope_deg ** 2)


def segment_slopes_deg(grade_pct: np.ndarray) -> np.ndarray:
    """Walking slope of each stretch between two track points (degrees, + = uphill).

    grade_pct is the smoothed slope from metrics.grade_percent (measured over
    60 m, so GPS noise doesn't add phantom steepness); each stretch uses the
    average of its two ends.
    """
    seg_grade = (grade_pct[:-1] + grade_pct[1:]) / 2
    return np.clip(np.degrees(np.arctan(seg_grade / 100)), -MAX_SLOPE_DEG, MAX_SLOPE_DEG)


def walking_time_s(dist_km: np.ndarray, grade_pct: np.ndarray, ground: list[str] | None = None) -> np.ndarray:
    """Seconds from the start to every track point, for the model's average walker.

    The website adjusts these for the reader's pace (web/src/lib/walking-time.js).
    """
    n = len(dist_km)
    if ground is None:
        ground = ["path"] * n
    seg_km = np.diff(dist_km)
    hours = seg_km / speed_kmh(segment_slopes_deg(grade_pct), np.array(ground[:-1]))
    return np.concatenate([[0.0], np.cumsum(hours) * 3600])


def time_by_slope(time_s: np.ndarray, slope_deg: np.ndarray, ground: list[str]) -> list[list]:
    """The model's walking time summed per ground type and whole degree of slope:
    [[mean slope (deg), ground, seconds], ...].

    The main page has no full tracks, but with this it works out each hike's time
    at the reader's pace the same way the hike page does (web/src/lib/walking-time.js).
    time_s: cumulative seconds per point (as stored); slope_deg / ground: per stretch.
    """
    seconds = np.diff(time_s)
    bins: dict[tuple[str, int], list[float]] = {}
    for s, slope, g in zip(seconds, slope_deg, ground):
        total = bins.setdefault((g, int(round(slope))), [0.0, 0.0])
        total[0] += s
        total[1] += s * slope
    return [
        [round(float(weighted / secs), 1) if secs else float(deg), g, int(round(secs))]
        for (g, deg), (secs, weighted) in sorted(bins.items())
    ]
