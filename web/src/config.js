// ==========================================
// --- APP CONTROL PANEL ---
// ==========================================
export const APP_CONFIG = {
    // 'metric' (km / m) or 'imperial' (mi / ft)
    units: 'metric',

    // Maps the reader can pick with the layer button on the hike map.
    // The first one is the default (and is used for the 'map' backdrop).
    // look: optional tint from src/styles/map-styles.css (.map-style-<look>).
    // A new map address also needs its host in TILE_HOSTS in public/sw.js (offline use).
    // offline: true = the map "Save for offline" stores (the first one marked; whatever map is on
    // screen). Only Park: OpenStreetMap's tile servers forbid saving for offline, and Esri only
    // allows it through their own apps.
    mapLayers: [
        {
            id: 'park', name: 'Park map', look: 'park', offline: true,
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17,
            attribution: '© OpenStreetMap · SRTM · OpenTopoMap (CC-BY-SA)',
        },
        {
            id: 'streets', name: 'Streets',
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
            attribution: '© OpenStreetMap',
        },
        {
            id: 'satellite', name: 'Satellite',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
            attribution: '© Esri, Maxar, Earthstar Geographics',
        },
        {
            id: 'topo', name: 'Topo',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
            attribution: '© Esri, HERE, Garmin, USGS, NGA, NPS',
        },
    ],

    // Blurred photo behind the page:
    //   'auto'        – the hike's own cover photo, otherwise one of the photos in backgrounds/
    //   'backgrounds' – always one of the photos in backgrounds/ (each hike keeps the same one)
    //   'map'         – the topo map of the hike's area
    //   'none'        – plain background
    // National park look (2026-11-14): every page uses the gorge photo DSC_4034 and its stone/olive colors.
    // Earlier pink sunset: backgroundChoices/indexBackground 'DSC_3651_1.JPG'. Per-hike photos:
    //   backdrop: 'auto', backgroundChoices: ['DSC_3651_1.JPG', 'DSC_0053_12.JPG', 'DSC_4195_12.JPG']
    backdrop: 'backgrounds',

    // Which photos from backgrounds/ may be used (file names). [] = all of them.
    backgroundChoices: ['DSC_4034.JPG'],

    // Which photo from backgrounds/ the hike list (index page) uses. '' = the first one.
    indexBackground: 'DSC_4034.JPG',

    // How soft the background is, in pixels. 0 = sharp.
    backdropBlur: 3,

    // 'dark' – deep glass tinted from the photo, light text
    // 'light' – light glass tinted from the photo, dark text
    theme: 'light',

    // How solid the glass sheet is: 0 = invisible, 1 = solid color
    glassOpacity: 0.6,

    // Keep these in sync with the CSS variables in styles/base.css
    colors: {
        trail: '#B30000',           // Trail line: NPS red. Forest green alternative: '#2F6B3A'
        trailCasing: null,          // Light edge under the trail line, e.g. '#FFF7F0' (null = none, like printed maps)
        terrain: '#6A6852',         // Fill under the elevation profile: olive-taupe, like the stone in the gorge photo (was brown '#7A6A55')
        markerLight: '#FFFFFF',     // Inside of the dot that follows your finger
        hoverLine: 'rgba(43, 36, 28, 0.45)',
    },

    // Zoomed-in elevation profile (full-screen map): how visible the rest of the
    // trail stays on the map, so the stretch you're looking at stands out.
    // 0 = hidden, 1 = no fading
    trailOutsideView: 0.3,

    // Names next to the stop symbols on the map: 'always', or 'hover' (only when you point at one)
    stopNames: 'always',

    // Slope (%) -> color of the elevation profile line. Values in between are blended.
    // 'warm' (in use), 'soft' or 'park'
    slopeScheme: 'warm',
    slopeSchemes: {
        // Warm, no pink: sage → mustard → orange → burnt orange → dark rust brown
        warm: [[0, '#8FAE7E'], [6, '#D9B44A'], [12, '#E0892B'], [20, '#B8501C'], [30, '#6B3014']],
        // Softened traffic light: sage → mustard → terracotta → brick → oxblood
        soft: [[0, '#8FAE7E'], [6, '#D9B85C'], [12, '#D98A5B'], [20, '#C4473D'], [30, '#6E2230']],
        // Printed map: sage → ochre → rust → brick → dark brown
        park: [[0, '#8A9A6B'], [6, '#C9A55A'], [12, '#B9733A'], [20, '#8C2F1B'], [30, '#4A2A1C']],
    },
    // How gently the profile line changes color: the steepness is averaged over
    // this fraction of the hike (0.01 = sharp, 0.03 = smooth, 0.06 = very smooth)
    slopeSmoothing: 0.03,
    // Thickness of the steepness line on the elevation profile, in px
    profileLineWidth: 4.5,
    get slopeColors() { return this.slopeSchemes[this.slopeScheme] ?? this.slopeSchemes.soft; },

    // Walking-time estimate and the tortoise–hare slider under the stats.
    // The maths is in src/lib/walking-time.js; the model itself in tools/hikebook/timing.py.
    pace: {
        // The model (brisk UK walkers) is a tinge fast: the middle of the slider
        // ("average pace") = calibration × the model's speed. 0.65 ≈ Komoot / DAV signposts.
        calibration: 0.65,
        // Slider range in % of that average pace: 70 = tortoise end, 145 = hare end
        default: 100, min: 70, max: 145, step: 5,
        // How strongly the slider acts at each steepness: [slope in degrees, strength].
        // 1 = fully (a tortoise at 70% is 30% slower there), 0.5 = half as much
        // (15% slower). In between is blended. Climbs depend most on fitness;
        // flat and gentle descents less; steep descents again more (sure-footedness, knees).
        // These are reasoned guesses, not measured — tune to taste.
        strength: [[-30, 0.85], [-12, 0.55], [-4, 0.5], [0, 0.6], [6, 0.9], [15, 1.0]],
        // Extra strength by ground type (added to the above): rough ground spreads people out more
        groundStrength: { paved: 0, path: 0, offtrail: 0.2 },
    },

    // How strongly the hover snaps onto nearby waypoints (fraction of total distance)
    gravity: {
        map: 0.02,
        elevation: 0.005,
    },

    // The two books built from this code. Which one: BOOK in the .env file at the top of
    // the repo (read by the Python tools and vite.config.js; src/lib/edition.js gets it from Vite).
    //   name      – shown in the site bar, tab title and as the installed app's name
    //   shortName – under the home-screen icon (keep it short)
    //   accounts  – the platform parts: demo users, "Viewing as", My hikes / Shared with me,
    //               hikes hidden from some people. false = everyone sees every hike.
    //   outDir    – where `npm run build` puts the site (inside web/)
    //   logo      – icon set from tools/make_icons.py: 'hb' = generic hiking logo, 'dn' = D&N logo
    //               (tab icon, home-screen icon and the logo in the site bar)
    editions: {
        public: { name: 'Hiking Book', shortName: 'Hiking Book', accounts: true, outDir: 'dist', logo: 'hb' },
        wedding: { name: 'Danna & Neil', shortName: 'D&N Hikes', accounts: false, outDir: 'dist-wedding', logo: 'dn' },
    },

    // The phone's own bars (clock + battery at the top, navigation at the bottom).
    // The ONLY place for this: vite.config.js writes `app` into the built manifest,
    // src/lib/full-screen.js and the full-screen map read it from here.
    // Android only. iPhones always show the clock (the page runs behind it).
    display: {
        // Installed app (home-screen icon):
        //   'standalone' – bars visible, no browser bar
        //   'fullscreen' – bars hidden (an app installed before a change keeps
        //                  its old setting until it's removed and installed again)
        app: 'standalone',
        // Full-screen map on phones: true = hide the bars while it's open
        mapHidesBars: true,
    },
};
