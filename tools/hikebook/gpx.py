"""Reading GPX files (track points, waypoints, metadata)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np


@dataclass
class Waypoint:
    name: str
    lat: float
    lon: float
    ele_m: float | None
    description: str = ""


@dataclass
class GpxData:
    name: str | None
    description: str | None
    lat: np.ndarray
    lon: np.ndarray
    ele_m: np.ndarray
    times: list[str | None]
    waypoints: list[Waypoint] = field(default_factory=list)


def read_gpx(path: Path) -> GpxData:
    root = ET.parse(path).getroot()
    ns = {"g": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {"g": ""}

    def text(el: ET.Element | None, tag: str) -> str | None:
        if el is None:
            return None
        child = el.find(f"g:{tag}", ns)
        return child.text.strip() if child is not None and child.text else None

    metadata = root.find("g:metadata", ns)
    track = root.find("g:trk", ns)

    lats, lons, eles, times = [], [], [], []
    for pt in root.iterfind(".//g:trkpt", ns):
        lats.append(float(pt.attrib["lat"]))
        lons.append(float(pt.attrib["lon"]))
        ele = text(pt, "ele")
        eles.append(float(ele) if ele is not None else np.nan)
        times.append(text(pt, "time"))

    if not lats:
        raise ValueError(f"No track points found in {path}")

    ele_m = np.array(eles, dtype=float)
    if np.isnan(ele_m).all():
        ele_m[:] = 0.0
    elif np.isnan(ele_m).any():  # fill gaps by interpolation
        idx = np.arange(len(ele_m))
        ok = ~np.isnan(ele_m)
        ele_m = np.interp(idx, idx[ok], ele_m[ok])

    waypoints = []
    for i, wpt in enumerate(root.iterfind(".//g:wpt", ns), start=1):
        ele = text(wpt, "ele")
        name = text(wpt, "name") or f"Waypoint {i}"
        waypoints.append(
            Waypoint(
                # komoot names look like "Curry Village;Yosemite National Park" -> keep first part
                name=name.split(";")[0].strip(),
                lat=float(wpt.attrib["lat"]),
                lon=float(wpt.attrib["lon"]),
                ele_m=float(ele) if ele is not None else None,
                description=text(wpt, "desc") or "",
            )
        )

    name = text(metadata, "name") or text(track, "name")
    if name and name.startswith("GPX Download: "):  # komoot export prefix
        name = name.removeprefix("GPX Download: ")

    return GpxData(
        name=name,
        description=text(metadata, "desc") or text(track, "desc"),
        lat=np.array(lats, dtype=float),
        lon=np.array(lons, dtype=float),
        ele_m=ele_m,
        times=times,
        waypoints=waypoints,
    )
