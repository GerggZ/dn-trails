// ==========================================
// --- APP CONTROL PANEL ---
// ==========================================
export const APP_CONFIG = {
    // 'metric' (km / m) or 'imperial' (mi / ft)
    units: 'metric',

    // Map background. OpenTopoMap shows contour lines and hillshading.
    // For the plain street map use:
    //   url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
    //   attribution: '© OpenStreetMap contributors'
    mapTiles: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        maxZoom: 17,
        attribution: 'Map data © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)',
    },

    // Blurred photo behind the page:
    //   'auto'        – the hike's own cover photo, otherwise one of the photos in backgrounds/
    //   'backgrounds' – always one of the photos in backgrounds/ (each hike keeps the same one)
    //   'map'         – the topo map of the hike's area
    //   'none'        – plain background
    // For now every page uses the pink sunset (same as the app icon). Back to per-hike photos:
    //   backdrop: 'auto', backgroundChoices: ['DSC_3651_1.JPG', 'DSC_0053_12.JPG', 'DSC_4195_12.JPG']
    backdrop: 'backgrounds',

    // Which photos from backgrounds/ may be used (file names). [] = all of them.
    backgroundChoices: ['DSC_3651_1.JPG'],

    // Which photo from backgrounds/ the hike list (index page) uses. '' = the first one.
    indexBackground: 'DSC_3651_1.JPG',

    // How soft the background is, in pixels. 0 = sharp.
    backdropBlur: 3,

    // 'dark' – deep glass tinted from the photo, light text
    // 'light' – light glass tinted from the photo, dark text
    theme: 'light',

    // How solid the glass sheet is: 0 = invisible, 1 = solid color
    glassOpacity: 0.6,

    // Keep these in sync with the CSS variables in styles/base.css
    colors: {
        trail: '#C8102E',           // Trail line (trail-marker red)
        trailCasing: '#FFFFFF',     // White edge around the trail line
        terrain: '#17261F',         // Fill under the elevation profile
        waypoint: '#F2C14E',        // Waypoint rings and their names in the tooltip
        markerDark: '#17261F',
        markerLight: '#FFFFFF',
        hoverLine: 'rgba(23, 38, 31, 0.45)',
    },

    // Slope (%) -> color of the elevation profile line. Values in between are blended.
    slopeColors: [
        [0, '#7FB069'],
        [6, '#F2C14E'],
        [12, '#E8833A'],
        [20, '#C8102E'],
        [30, '#6B0F1A'],
    ],

    // How strongly the hover snaps onto nearby waypoints (fraction of total distance)
    gravity: {
        map: 0.02,
        elevation: 0.005,
    },
};
