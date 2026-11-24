"""Lighter copies of a trail for the overview map (Douglas–Peucker simplification).

Instead of keeping every k-th point, this drops points that move the line by
less than a tolerance in metres. Short hikes end up with few points, long or
twisty ones with more, and each level looks right at the zoom it's used at
(error below about a screen pixel there).
"""

from __future__ import annotations

import numpy as np

EARTH_RADIUS_M = 6371008.8


def _local_xy(lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Flat coordinates in metres around the trail (plenty accurate for one hike)."""
    lat0 = np.radians(np.mean(lat))
    x = np.radians(lon - lon[0]) * np.cos(lat0) * EARTH_RADIUS_M
    y = np.radians(lat - lat[0]) * EARTH_RADIUS_M
    return x, y


def simplify_indices(lat: np.ndarray, lon: np.ndarray, tolerance_m: float) -> np.ndarray:
    """Indices of the points Douglas–Peucker keeps (first and last always kept)."""
    n = len(lat)
    if n <= 2:
        return np.arange(n)
    x, y = _local_xy(lat, lon)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        xs, ys = x[a + 1:b], y[a + 1:b]
        dx, dy = x[b] - x[a], y[b] - y[a]
        length = np.hypot(dx, dy)
        if length < 1e-9:  # loop: start and end at the same spot -> distance to that spot
            d = np.hypot(xs - x[a], ys - y[a])
        else:
            d = np.abs(dy * (xs - x[a]) - dx * (ys - y[a])) / length
        i = int(np.argmax(d))
        if d[i] > tolerance_m:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return np.flatnonzero(keep)


def simplified_line(lat: np.ndarray, lon: np.ndarray, tolerance_m: float, decimals: int) -> list[list[float]]:
    """[[lat, lon], ...] of the simplified trail, rounded to `decimals`."""
    idx = simplify_indices(lat, lon, tolerance_m)
    return [[round(float(lat[i]), decimals), round(float(lon[i]), decimals)] for i in idx]
