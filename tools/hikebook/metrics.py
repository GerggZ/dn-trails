"""Distances, elevation gain, slope and other numbers computed from a track.

Everything is metric here (km, m). The website converts to miles/feet if
you switch it to imperial in web/src/config.js.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np

EARTH_RADIUS_KM = 6371.0088

# Elevation changes smaller than this are treated as GPS noise when
# summing up ascent/descent (otherwise gain gets wildly overcounted).
ASCENT_NOISE_THRESHOLD_M = 3.0

# Slope is measured over this horizontal window instead of point-to-point,
# which is far too jumpy with GPS data.
SLOPE_WINDOW_M = 60.0


def cumulative_distance_km(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    phi = np.radians(lat)
    lam = np.radians(lon)
    dphi = np.diff(phi)
    dlam = np.diff(lam)
    a = np.sin(dphi / 2) ** 2 + np.cos(phi[:-1]) * np.cos(phi[1:]) * np.sin(dlam / 2) ** 2
    step = 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    return np.concatenate([[0.0], np.cumsum(step)])


def ascent_descent_m(ele_m: np.ndarray, threshold: float = ASCENT_NOISE_THRESHOLD_M) -> tuple[float, float]:
    """Sum climbs/descents, ignoring wiggles smaller than `threshold`."""
    ascent = descent = 0.0
    ref = ele_m[0]
    for e in ele_m[1:]:
        diff = e - ref
        if diff >= threshold:
            ascent += diff
            ref = e
        elif diff <= -threshold:
            descent -= diff
            ref = e
    return ascent, descent


def grade_percent(dist_km: np.ndarray, ele_m: np.ndarray, window_m: float = SLOPE_WINDOW_M) -> np.ndarray:
    """Slope (%) at every point, measured across +-window/2 around it."""
    d_m = dist_km * 1000
    half = window_m / 2
    lo = np.clip(d_m - half, d_m[0], d_m[-1])
    hi = np.clip(d_m + half, d_m[0], d_m[-1])
    run = hi - lo
    rise = np.interp(hi, d_m, ele_m) - np.interp(lo, d_m, ele_m)
    with np.errstate(divide="ignore", invalid="ignore"):
        grade = np.where(run > 0, 100 * rise / run, 0.0)
    return grade


def duration_hours(times: list[str | None]) -> float | None:
    stamps = [t for t in times if t]
    if len(stamps) < 2:
        return None
    try:
        start = datetime.fromisoformat(stamps[0].replace("Z", "+00:00"))
        end = datetime.fromisoformat(stamps[-1].replace("Z", "+00:00"))
    except ValueError:
        return None
    hours = (end - start).total_seconds() / 3600
    return hours if hours > 0 else None


def start_date(times: list[str | None]) -> str | None:
    for t in times:
        if t:
            return t[:10]
    return None


def nearest_index(lat: np.ndarray, lon: np.ndarray, p_lat: float, p_lon: float) -> int:
    # Equirectangular approximation is plenty for "which track point is closest"
    x = (lon - p_lon) * np.cos(np.radians(p_lat))
    y = lat - p_lat
    return int(np.argmin(x * x + y * y))


def bbox(lat: np.ndarray, lon: np.ndarray) -> list[list[float]]:
    return [
        [round(float(lat.min()), 6), round(float(lon.min()), 6)],
        [round(float(lat.max()), 6), round(float(lon.max()), 6)],
    ]
