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
    mapLayers: [
        {
            id: 'park', name: 'Park map', look: 'park',
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17,
            attribution: 'Map data © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)',
        },
        {
            id: 'streets', name: 'Streets',
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
            attribution: '© OpenStreetMap contributors',
        },
        {
            id: 'satellite', name: 'Satellite',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
            attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, GIS User Community',
        },
        {
            id: 'topo', name: 'Topo',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
            attribution: 'Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, EPA, NPS',
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

    // Names next to the stop symbols on the map: 'always', or 'hover' (only when you point at one)
    stopNames: 'always',

    // Slope (%) -> color of the elevation profile line. Values in between are blended.
    // 'soft' or 'park' (compare them on map-test.html in `npm run dev`).
    slopeScheme: 'soft',
    slopeSchemes: {
        // Softened traffic light: sage → mustard → terracotta → brick → oxblood
        soft: [[0, '#8FAE7E'], [6, '#D9B85C'], [12, '#D98A5B'], [20, '#C4473D'], [30, '#6E2230']],
        // Printed map: sage → ochre → rust → brick → dark brown
        park: [[0, '#8A9A6B'], [6, '#C9A55A'], [12, '#B9733A'], [20, '#8C2F1B'], [30, '#4A2A1C']],
    },
    get slopeColors() { return this.slopeSchemes[this.slopeScheme] ?? this.slopeSchemes.soft; },

    // How strongly the hover snaps onto nearby waypoints (fraction of total distance)
    gravity: {
        map: 0.02,
        elevation: 0.005,
    },
};
