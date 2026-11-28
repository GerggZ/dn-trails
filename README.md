# Hiking Book

An interactive book of our hikes, built as an installable web app that works offline on the trail.
Each hike gets a map, a slope-colored elevation profile, stats, a walking-time estimate and a photo gallery.

Live: https://gerggz.github.io/dn-trails/

## Features

- **Map + profile in sync.** Scrub the profile and the dot moves on the map; pinch-zoom the profile in full screen and the map glides along.
- **Offline.** "Save for offline" stores a hike's data, photos and map tiles on the device (hand-written service worker, no Workbox).
- **Your location** on the map and the profile, with distance and walking time left.
- **Walking time** from a published hiking-speed model ([Wood et al. 2023](https://doi.org/10.1371/journal.pone.0295848)) using slope and ground type from OpenStreetMap, adjustable to your pace.
- **Main page:** all hikes on one map, place search, and the hikes nearest to a tapped trail.

## Stack

Vite, vanilla JS, Leaflet, d3. Python (numpy, Pillow) turns GPX files and photos into the site's data.
Vitest + Playwright for tests, Sentry for error reports.

## Layout

```
hikes/<id>/        track.gpx, info.json, description.md, photos/   ← the content
tools/             build_hikes.py (hikes/ → web/public/data), new_hike.py, fetch_osm.py
web/src/
  directory.js     main page          directory/   its parts (list, sheet, cards, search)
  hike.js          hike page          hike/trail/  map, profile, gestures, camera, full screen
  sw.js            service worker     offline/     offline storage, shared with the pages
  lib/             shared by both pages
  config.js        units, colors, map layers, pace
```

## Running it

```powershell
python -m venv .venv; .venv\Scripts\activate; pip install -r tools\requirements.txt
cd web; npm install
npm run dev          # http://127.0.0.1:5180   (npm run dev:phone for the same Wi-Fi)
npm run check        # lint + unit tests
npm run build; npm run preview; npm run test:e2e   # offline, install and location need the build
```

## Adding a hike

1. Set `GPX_FILE` in `tools/new_hike.py` and run it. This creates `hikes/<random id>/`.
2. Add photos and fill in `info.json`, plus `description.md` for the story.
3. Run `python tools/build_hikes.py` (or `npm run data`). Unchanged hikes are skipped.

| `info.json` | |
|---|---|
| `title`, `date`, `location` | empty title/date → taken from the GPX |
| `cover`, `captions` | main photo; captions by filename |
| `companions`, `difficulty` | shown on the page |
| `owner`, `public`, `shared_with` | demo sharing (users.json); not enforced, everything is public |
| `draft` | `true` hides the hike |
| `ground` | `auto` (OpenStreetMap), `paved`, `path` or `offtrail` |

Distance, climb and highest point come from the GPX.

## Two books

`BOOK` in `.env` (see `.env.example`) picks the book: `public` (`hikes/`, GitHub Pages) or `wedding`
(`wedding_hikes/`, private, never committed, Cloudflare Pages + Access).
Rebuild the data after switching. `npm run deploy` / `npm run deploy:wedding` lint, test and check the book before publishing.
