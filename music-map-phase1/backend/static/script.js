/**
* Global Music Explorer - script.js
*
* Handles Mapbox GL JS map initialization, Spotify data fetching,
* marker clustering, popups, list interaction, and UI updates.
*
* Version 3.5: Fix time range button event listeners by selecting buttons
* via class name instead of non-existent IDs.
*/

// --- Configuration ---
mapboxgl.accessToken = 'pk.eyJ1IjoiamdyZWdnLWNyZXNhIiwiYSI6ImNtOXU5aTZ0bjA3YXQybm9sdTM2ZnI5MGkifQ.4m79tGP_Nuxq-wg0-5bHqw'; // Replace with your token

// --- Constants ---
const ARTIST_SOURCE_ID = 'artist-locations';
const CLUSTER_LAYER_ID_CIRCLE = 'artist-clusters-circle';
const CLUSTER_LAYER_ID_COUNT = 'artist-clusters-count';
const UNCLUSTERED_POINT_LAYER_ID_ICON = 'unclustered-artists-icon';
const PLACEHOLDER_IMG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PLACEHOLDER_ICON_ID = 'placeholder-artist-icon';
const ICON_SIZE_PX = 140;
const ICON_BORDER_WIDTH_PX = 10;
const MAP_ICON_DISPLAY_SIZE = 0.35;
const CLUSTER_RADIUS = 45;
const CLUSTER_MAX_ZOOM = 14;
const FLY_TO_ZOOM_UNCLUSTERED = 10;
const CLUSTER_FIT_BOUNDS_MAX_ZOOM = CLUSTER_MAX_ZOOM;
const FLY_TO_SPEED = 0.8;
const POPUP_OFFSET_POINT = 15;
const POPUP_OFFSET_CLUSTER = 25;
const POPUP_MAX_WIDTH = '300px';
const HOVER_POPUP_OFFSET = 10;

// --- DOM Elements ---
const artistListContainer = document.getElementById('artist-list');
// Removed specific button IDs as they don't exist in HTML
// const shortTermButton = document.getElementById('fetch-short-term');
// const mediumTermButton = document.getElementById('fetch-medium-term');
// const longTermButton = document.getElementById('fetch-long-term');
const timeRangeButtons = document.querySelectorAll('.time-range-btn'); // Select by class
const flashMessageElement = document.getElementById('flash-message');
const loadingOverlay = document.querySelector('.loading-overlay');
const mapContainer = document.getElementById('map');

// --- Global State ---
let map;
let currentClickPopup = null;
let currentHoverPopup = null;
const artistDataStore = {};
// Initialize active button based on the one with 'active' class in HTML
let activeTimeRangeButton = document.querySelector('.time-range-btn.active');
const loadedImageIds = new Set();
let placeholderLoaded = false;
let flashTimeoutId = null;
let hoveredArtistFeatureId = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
console.log("DOM fully loaded and parsed. Initializing app.");
if (!mapboxgl.accessToken || mapboxgl.accessToken.includes('YOUR_MAPBOX_ACCESS_TOKEN') || mapboxgl.accessToken.length < 10) {
console.error("Mapbox Access Token is not set, is a placeholder, or seems invalid!");
showFlashMessage("Map configuration error. Please check console.", 5000, true);
if(mapContainer) mapContainer.innerHTML = '<p style="color: red; padding: 20px;">Map disabled due to configuration error.</p>';
return;
}
if (!mapContainer) {
console.error("Map container element (#map) not found!");
document.body.innerHTML = '<p style="color: red; padding: 20px;">Critical Error: Map container not found.</p>' + document.body.innerHTML;
return;
}
setupMap();
setupEventListeners(); // Setup listeners after map init

if (document.getElementById('logout-button')) {
// Use the initially active button's range for the first fetch
const initialRange = activeTimeRangeButton ? activeTimeRangeButton.dataset.range : 'medium_term';
map.once('idle', () => {
console.log(`Map idle. Performing initial artist fetch for range: ${initialRange}.`);
fetchAndDisplayArtists(initialRange);
});
} else {
console.log("User not logged in. Skipping initial fetch.");
}
}

// // --- Map Setup ---
// function setupMap() {
// console.log("Initializing Mapbox GL JS map.");
// try {
// map = new mapboxgl.Map({
// container: 'map',
// // style: 'mapbox://styles/mapbox/dark-v11',
// style: 'mapbox://styles/mapbox/satellite-streets-v12',
// center: [0, 20],
// zoom: 1.5,
// projection: 'mercator',
// antialias: true
// });

// --- Map Setup ---
function setupMap() {
    console.log("Initializing Mapbox GL JS map.");
    try {
map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/jgregg-cresa/cm9ydw0o9000a01rz91ax1l0u', // <-- Replace this with your custom style
    center: [0, 20],
    zoom: 1.5,
    projection: 'mercator',
    antialias: true
});

// Set up ONE listener for the 'load' event
map.on('load', handleMapLoad);

map.on('error', (e) => {
console.error("Mapbox GL Error:", e.error || e);
showFlashMessage("Map error occurred. Please try refreshing.", 5000, true);
});
} catch (error) {
console.error("Failed to initialize Mapbox GL map:", error);
showFlashMessage("Could not initialize map. Check console.", 5000, true);
if(mapContainer) mapContainer.innerHTML = '<p style="color: red; padding: 20px;">Map failed to initialize.</p>';
}
}

// This function runs ONCE after the map style is loaded
function handleMapLoad() {
console.log("Map style loaded.");

// --- Add Controls ---
map.addControl(new mapboxgl.NavigationControl(), 'top-left');
map.addControl(new mapboxgl.ScaleControl());

map.setFog({
'color': '#1a1f2a', // Very dark gray-blue near the ground
'high-color': '#000510', // Nearly black for high atmosphere
'horizon-blend': 0.15, // Slightly less blending
'space-color': '#0b0b19', // Deep space tone
'star-intensity': 0.15 // Slight star sparkle, not too much
});

// --- Load Custom Images/Resources ---
createCircularImage(PLACEHOLDER_IMG_URL, PLACEHOLDER_ICON_ID)
.then(() => {
placeholderLoaded = true;
console.log("Circular placeholder image loaded successfully.");
// Now you can safely add layers that USE this image
})
.catch(err => {
console.error("FATAL: Failed to load circular placeholder image:", err);
showFlashMessage("Error loading essential map resources. Please refresh.", 5000, true);
});

// --- Add other layers, markers, data sources etc. here ---
// Example: add3DBuildings();
// Example: loadDataLayers();
}

// --- Event Listeners Setup ---
function setupEventListeners() {
console.log("Setting up UI event listeners.");

// *** FIXED: Use querySelectorAll to get buttons by class ***
timeRangeButtons.forEach(button => {
button.addEventListener('click', () => {
// Check if the button is already active or if data is loading
if (!button.classList.contains('active') && !document.body.classList.contains('loading')) {
fetchAndDisplayArtists(button.dataset.range);
} else if (button.classList.contains('active')) {
console.log("Clicked already active time range button.");
} else {
console.log("Ignoring button click while loading.");
}
});
});

if (artistListContainer) {
artistListContainer.addEventListener('click', handleArtistListClick);
} else {
console.warn("Artist list container not found. List interactions disabled.");
}
}

// --- Data Fetching and Processing ---
async function fetchAndDisplayArtists(timeRange = 'medium_term') {
if (!placeholderLoaded || !map || !map.isStyleLoaded()) {
console.warn("Map or resources not ready. Aborting fetch.");
showFlashMessage("Map not ready. Please wait...", 3000);
return;
}
console.log(`Fetching top artists for time range: ${timeRange}`);
setLoadingState(true);
showFlashMessage(`Fetching your top artists (${timeRange.replace('_', ' ')})...`);
updateActiveButton(timeRange); // Update active button state
removeArtistLayersAndSource();
artistListContainer.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading artists...</p></div>`;
Object.keys(artistDataStore).forEach(key => delete artistDataStore[key]);
const fetchUrl = `/top-artists?time_range=${timeRange}`;

try {
const response = await fetch(fetchUrl);
if (!response.ok) {
let errorMsg = `HTTP error ${response.status}`;
try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch (e) {}
throw new Error(errorMsg);
}
const artists = await response.json();
if (!Array.isArray(artists)) throw new Error("Received unexpected data format.");
console.log(`Received ${artists.length} artists.`);
artistListContainer.innerHTML = '';

if (artists.length === 0) {
artistListContainer.innerHTML = `<div class="empty-state"><i class="fas fa-compact-disc"></i><p>No top artists found for this period.</p></div>`;
showFlashMessage(`No top artists found for ${timeRange.replace('_', ' ')}.`);
setLoadingState(false); return;
}

const imageLoadPromises = [];
const uniqueImageUrls = new Map();
let locatedCount = 0;
artists.forEach((artist, index) => {
artist.id = String(artist.id || (artist.uri ? artist.uri.split(':').pop() : `generated-${artist.name}-${index}`));
artist.rank = index + 1;
artistDataStore[artist.id] = artist;
const listItemHtml = createArtistListItem(artist, artist.rank);
artistListContainer.insertAdjacentHTML('beforeend', listItemHtml);
if (isValidCoordinate(artist.lat) && isValidCoordinate(artist.lon)) {
locatedCount++;
if (artist.image_url && !uniqueImageUrls.has(artist.image_url)) {
const iconId = generateIconId(artist);
uniqueImageUrls.set(artist.image_url, iconId);
imageLoadPromises.push(createCircularImage(artist.image_url, iconId));
console.log(JSON.stringify(artists, null, 2));
}
}
});

console.log(`Attempting to load ${imageLoadPromises.length} unique artist images...`);
const imageLoadResults = await Promise.allSettled(imageLoadPromises);
const successfullyLoadedIconIds = new Map();
imageLoadResults.forEach((result, index) => {
const originalUrl = Array.from(uniqueImageUrls.keys())[index];
const intendedIconId = uniqueImageUrls.get(originalUrl);
if (result.status === 'fulfilled' && result.value === intendedIconId) {
successfullyLoadedIconIds.set(originalUrl, intendedIconId);
} else { console.warn(`Failed to load image for ${intendedIconId} (URL: ${originalUrl}):`, result.reason || 'Unknown error'); }
});
console.log(`Successfully loaded ${successfullyLoadedIconIds.size} / ${uniqueImageUrls.size} unique artist images.`);

const features = artists
.filter(artist => isValidCoordinate(artist.lat) && isValidCoordinate(artist.lon))
.map(artist => {
const assignedIconId = successfullyLoadedIconIds.get(artist.image_url) || PLACEHOLDER_ICON_ID;
return {
type: 'Feature', id: artist.id,
geometry: { type: 'Point', coordinates: [parseFloat(artist.lon), parseFloat(artist.lat)] },
properties: { artistId: artist.id, name: artist.name || 'Unknown Artist', iconId: assignedIconId, rank: artist.rank }
};
});

const artistGeoJSON = { type: 'FeatureCollection', features: features };
setupArtistLayers(artistGeoJSON);
showFlashMessage(`Displaying ${artists.length} artists. ${locatedCount} located on the map.`);
if (features.length > 0) fitBoundsToGeoJSON(artistGeoJSON);

} catch (error) {
console.error('Error fetching or processing artists:', error);
artistListContainer.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error loading artists: ${error.message}</p></div>`;
showFlashMessage(`Error: ${error.message}`, 5000, true);
removeArtistLayersAndSource();
} finally { setLoadingState(false); }
}

// --- Map Layer Management ---
function setupArtistLayers(artistGeoJSON) {
if (!map || !map.isStyleLoaded() || !placeholderLoaded || !map.hasImage(PLACEHOLDER_ICON_ID)) {
console.error("Cannot add layers: Map or placeholder not ready.");
showFlashMessage("Map resources error. Cannot display artists.", 4000, true); return;
}
if (!artistGeoJSON || !artistGeoJSON.features || artistGeoJSON.features.length === 0) {
console.log("No artist features to add to map."); return;
}
console.log("Setting up map layers for artists.");
if (!map.getSource(ARTIST_SOURCE_ID)) {
map.addSource(ARTIST_SOURCE_ID, {
type: 'geojson',
data: artistGeoJSON,
cluster: true,
clusterMaxZoom: CLUSTER_MAX_ZOOM,
clusterRadius: CLUSTER_RADIUS,
promoteId: 'id'
});
console.log("Added new artist source.");
} else {
map.getSource(ARTIST_SOURCE_ID).setData(artistGeoJSON);
console.log("Updated existing artist source data.");
}

if (!map.getLayer(CLUSTER_LAYER_ID_CIRCLE)) {
map.addLayer({
id: CLUSTER_LAYER_ID_CIRCLE,
type: 'circle',
source: ARTIST_SOURCE_ID,
filter: ['has', 'point_count'],
paint: {
// 1. Dynamic color based on cluster size
'circle-color': [
'step',
['get', 'point_count'],
'#4ddc7c', // Light green for small clusters (2-5)
6, // Threshold
'#1DB954', // Spotify green for medium clusters (6-15)
16, // Threshold
'#147b38' // Dark green for large clusters (16+)
],
// 2. Dynamic sizing based on cluster size
'circle-radius': [
'step',
['get', 'point_count'],
20, // 20px radius for small clusters (2-5)
6, // Threshold
25, // 25px radius for medium clusters (6-15)
16, // Threshold
30 // 30px radius for large clusters (16+)
],
// 3. Better styling
'circle-stroke-width': 2.5,
'circle-stroke-color': 'rgba(255, 255, 255, 0.5)', // White border with 50% opacity
'circle-opacity': 0.9 // 90% opacity for better visibility
}
});
}
if (!map.getLayer(CLUSTER_LAYER_ID_COUNT)) {
map.addLayer({
id: CLUSTER_LAYER_ID_COUNT,
type: 'symbol',
source: ARTIST_SOURCE_ID,
filter: ['has', 'point_count'],
layout: {
'text-field': '{point_count_abbreviated}',
'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
'text-size': 12,
'text-allow-overlap': true
},
paint: {
'text-color': '#ffffff'
}
});
}
if (!map.getLayer(UNCLUSTERED_POINT_LAYER_ID_ICON)) {
map.addLayer({
id: UNCLUSTERED_POINT_LAYER_ID_ICON,
type: 'symbol',
source: ARTIST_SOURCE_ID,
filter: ['!', ['has', 'point_count']],
layout: {
'icon-image': ['coalesce', ['get', 'iconId'], PLACEHOLDER_ICON_ID],
'icon-size': [
'interpolate',
['linear'],
['zoom'],
0, MAP_ICON_DISPLAY_SIZE * 0.8,
5, MAP_ICON_DISPLAY_SIZE
],
'icon-allow-overlap': true,
'icon-ignore-placement': false
},
paint: {
'icon-opacity': 0.95
}
});
}
addMapLayerEventHandlers();
}

function removeArtistLayersAndSource() {
if (!map) return;
console.log("Removing existing artist layers and source.");
removeMapLayerEventHandlers();
if (currentClickPopup) { currentClickPopup.remove(); currentClickPopup = null; }
if (currentHoverPopup) { currentHoverPopup.remove(); currentHoverPopup = null; }
hoveredArtistFeatureId = null;
const layersToRemove = [ UNCLUSTERED_POINT_LAYER_ID_ICON, CLUSTER_LAYER_ID_COUNT, CLUSTER_LAYER_ID_CIRCLE ];
layersToRemove.forEach(layerId => { if (map.getLayer(layerId)) { try { map.removeLayer(layerId); } catch (e) { console.warn(`Error removing layer ${layerId}:`, e.message); } } });
if (map.getSource(ARTIST_SOURCE_ID)) { try { map.removeSource(ARTIST_SOURCE_ID); } catch (e) { console.warn(`Error removing source ${ARTIST_SOURCE_ID}:`, e.message); } }
console.log("Finished removing layers and source.");
}

// --- Map Interaction Handlers ---
function addMapLayerEventHandlers() {
if (!map) return;
map.on('click', CLUSTER_LAYER_ID_CIRCLE, handleClusterClick);
map.on('click', UNCLUSTERED_POINT_LAYER_ID_ICON, handleUnclusteredPointClick);
map.on('mouseenter', UNCLUSTERED_POINT_LAYER_ID_ICON, handleUnclusteredPointMouseEnter);
map.on('mouseleave', UNCLUSTERED_POINT_LAYER_ID_ICON, handleUnclusteredPointMouseLeave);
map.on('mouseenter', CLUSTER_LAYER_ID_CIRCLE, handleClusterMouseEnterSimple);
map.on('mouseleave', CLUSTER_LAYER_ID_CIRCLE, handleClusterMouseLeaveSimple);
map.on('mouseenter', CLUSTER_LAYER_ID_CIRCLE, () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseenter', UNCLUSTERED_POINT_LAYER_ID_ICON, () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', CLUSTER_LAYER_ID_CIRCLE, () => { map.getCanvas().style.cursor = ''; });
map.on('mouseleave', UNCLUSTERED_POINT_LAYER_ID_ICON, () => { map.getCanvas().style.cursor = ''; });
console.log("Added map layer event handlers.");
}

function removeMapLayerEventHandlers() {
if (!map) return;
map.off('click', CLUSTER_LAYER_ID_CIRCLE, handleClusterClick);
map.off('click', UNCLUSTERED_POINT_LAYER_ID_ICON, handleUnclusteredPointClick);
map.off('mouseenter', UNCLUSTERED_POINT_LAYER_ID_ICON, handleUnclusteredPointMouseEnter);
map.off('mouseleave', UNCLUSTERED_POINT_LAYER_ID_ICON, handleUnclusteredPointMouseLeave);
map.off('mouseenter', CLUSTER_LAYER_ID_CIRCLE, handleClusterMouseEnterSimple);
map.off('mouseleave', CLUSTER_LAYER_ID_CIRCLE, handleClusterMouseLeaveSimple);
try { map.getCanvas().style.cursor = ''; } catch (e) { console.warn("Could not reset map cursor style:", e.message); }
console.log("Removed map layer event handlers.");
}

// --- Specific Event Handler Functions ---
function handleClusterClick(e) {
    const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_LAYER_ID_CIRCLE] });
    if (!features.length || !features[0].properties.cluster) return;

    const clusterId = features[0].properties.cluster_id;
    const pointCount = features[0].properties.point_count;
    const clusterCoords = features[0].geometry.coordinates.slice();
    const source = map.getSource(ARTIST_SOURCE_ID);
    const currentZoom = map.getZoom();

    if (!source || typeof source.getClusterExpansionZoom !== 'function') {
        console.error("Artist source is not available or doesn't support clustering methods.");
        return;
    }

    if (currentClickPopup) currentClickPopup.remove();

    source.getClusterExpansionZoom(clusterId, (err, expansionZoom) => {
        if (err) {
            console.error('Error getting cluster expansion zoom:', err);
            map.easeTo({
                center: clusterCoords,
                zoom: Math.min(currentZoom + 2, map.getMaxZoom()),
                duration: 800, easing: (t) => t * (2 - t), essential: true
            });
            return;
        }

        // Determine if this click leads to the final unclustered view
        const shouldShowArtistListPopup = expansionZoom > CLUSTER_MAX_ZOOM;

        // Define a reasonable maximum zoom cap for clicks
        const maxReasonableZoom = Math.min(map.getMaxZoom(), CLUSTER_MAX_ZOOM + 2); // e.g., Don't zoom past clusterMaxZoom + 2 levels

        let targetZoom;

        if (shouldShowArtistListPopup) {
            // --- FINAL CLICK ZOOM LOGIC (Less Aggressive) ---
            // Calculate zoom based on the standard increment.
            const zoomIncrement = pointCount > 15 ? 1.5 :
                                 pointCount > 5 ? 2 :
                                 2.5;
            targetZoom = currentZoom + zoomIncrement;

            // Crucially: DO NOT force zoom up to expansionZoom here.
            // Instead, just ensure the calculated zoom is enough to pass the threshold.
            targetZoom = Math.max(targetZoom, CLUSTER_MAX_ZOOM + 0.5); // Ensure we are definitely past the clustering threshold

            // Apply the overall cap
            targetZoom = Math.min(targetZoom, maxReasonableZoom);
            console.log(`Final Click Zoom Strategy: Using increment ${zoomIncrement}. Initial target: ${(currentZoom + zoomIncrement).toFixed(2)}. Min threshold adjust: ${targetZoom.toFixed(2)}. Final capped: ${targetZoom.toFixed(2)}`);

        } else {
            // --- INTERMEDIATE CLICK ZOOM LOGIC ---
            // For intermediate clicks, zoom *to* the expansionZoom level
            // to ensure the cluster breaks apart as expected by Mapbox.
            targetZoom = expansionZoom;

            // Apply the overall cap to prevent excessive jumps even here
            targetZoom = Math.min(targetZoom, maxReasonableZoom);

            // Ensure we actually zoom *in* if expansionZoom is somehow <= currentZoom
            targetZoom = Math.max(targetZoom, currentZoom + 0.1);
             console.log(`Intermediate Click Zoom Strategy: Targeting expansionZoom (${expansionZoom.toFixed(2)}). Final capped: ${targetZoom.toFixed(2)}`);
        }

        console.log(`Cluster Click: ID=${clusterId}, currentZoom=${currentZoom.toFixed(2)}, pointCount=${pointCount}, expansionZoom=${expansionZoom.toFixed(2)}, CLUSTER_MAX_ZOOM=${CLUSTER_MAX_ZOOM}, showPopup=${shouldShowArtistListPopup}, final targetZoom=${targetZoom.toFixed(2)}`);

        // --- Perform Zoom ---
        map.easeTo({
            center: clusterCoords,
            zoom: targetZoom, // Use the calculated targetZoom based on the logic above
            duration: 800,
            easing: (t) => t * (2 - t),
            essential: true
        });

        // --- Conditionally Fetch Leaves and Show Popup ---
        if (shouldShowArtistListPopup) {
            // (The rest of the popup fetching and display logic remains unchanged)
            source.getClusterLeaves(clusterId, pointCount, 0, (leavesErr, leaves) => {
                if (leavesErr) {
                    console.error('Error getting cluster leaves:', leavesErr); return;
                }
                if (!leaves || leaves.length === 0) {
                     console.warn('No leaves found for cluster:', clusterId); return;
                }
                const artistsInCluster = leaves
                    .map(leaf => {
                        const artistId = leaf.properties?.artistId;
                        return artistId ? artistDataStore[String(artistId)] : null;
                    })
                    .filter(Boolean)
                    .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || (a.name || '').localeCompare(b.name || ''));
                if (artistsInCluster.length === 0) {
                    console.warn('No matching artists found in data store for cluster leaves:', clusterId); return;
                }
                setTimeout(() => {
                    if (!map || !map.getSource(ARTIST_SOURCE_ID)) return;
                    if (currentClickPopup) currentClickPopup.remove();
                    const popupHTML = createClusterPopupContent(artistsInCluster, pointCount);
                    currentClickPopup = new mapboxgl.Popup({
                        offset: POPUP_OFFSET_CLUSTER, closeButton: true, maxWidth: POPUP_MAX_WIDTH, className: 'cluster-popup',
                    })
                    .setLngLat(clusterCoords).setHTML(popupHTML).addTo(map);
                    addClusterPopupEventListeners(currentClickPopup, artistsInCluster);
                }, 400);
            });
        }
    });
}

function handleUnclusteredPointClick(e) {
if (!e.features || !e.features.length) return;
const featureProperties = e.features[0].properties;
const featureId = featureProperties?.artistId;
if (featureId === null || featureId === undefined) {
console.warn("Clicked unclustered point missing 'artistId' in properties.", featureProperties);
console.log("Clicked feature details:", e.features[0]); return;
}
const lookupId = String(featureId);
const artist = artistDataStore[lookupId];
if (!artist) {
console.warn("Artist data not found in store for ID:", featureId, `(Lookup ID: ${lookupId})`);
console.log("Available keys sample:", Object.keys(artistDataStore).slice(0, 10));
showFlashMessage("Artist details not available.", 2000); return;
}
console.log("Found artist:", artist.name, "(ID:", lookupId, ")");
const coordinates = e.features[0].geometry.coordinates.slice();
while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) { coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360; }
map.flyTo({ center: coordinates, zoom: Math.max(map.getZoom(), FLY_TO_ZOOM_UNCLUSTERED), speed: FLY_TO_SPEED, essential: true });
const popupHTML = createArtistPopupContent(artist);
if (currentClickPopup) currentClickPopup.remove();
currentClickPopup = new mapboxgl.Popup({ offset: POPUP_OFFSET_POINT, closeButton: true, maxWidth: POPUP_MAX_WIDTH })
.setLngLat(coordinates).setHTML(popupHTML).addTo(map);
highlightListItem(artist.id);
}

// --- Hover Handlers ---
function handleUnclusteredPointMouseEnter(e) {
if (!map.isMoving() && e.features && e.features.length > 0) {
map.getCanvas().style.cursor = 'pointer';
if (currentHoverPopup) currentHoverPopup.remove();
hoveredArtistFeatureId = e.features[0].properties?.artistId;
const properties = e.features[0].properties;
const coordinates = e.features[0].geometry.coordinates.slice();
if (properties && properties.name) {
while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) { coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360; }
currentHoverPopup = new mapboxgl.Popup({ offset: HOVER_POPUP_OFFSET, closeButton: false, closeOnClick: false, className: 'mapboxgl-popup-hover' })
.setLngLat(coordinates).setHTML(`<strong>${properties.name}</strong>`).addTo(map);
}
}
}

function handleUnclusteredPointMouseLeave() {
map.getCanvas().style.cursor = '';
hoveredArtistFeatureId = null;
if (currentHoverPopup) { currentHoverPopup.remove(); currentHoverPopup = null; }
}

function handleClusterMouseEnterSimple(e) {
if (!map.isMoving() && e.features && e.features.length > 0 && e.features[0].properties.cluster) {
map.getCanvas().style.cursor = 'pointer';
const properties = e.features[0].properties;
const count = properties.point_count_abbreviated;
const coordinates = e.features[0].geometry.coordinates.slice();
if (currentHoverPopup) currentHoverPopup.remove();
currentHoverPopup = new mapboxgl.Popup({ offset: HOVER_POPUP_OFFSET, closeButton: false, closeOnClick: false, className: 'mapboxgl-popup-hover' })
.setLngLat(coordinates).setHTML(`<strong>${count} artists</strong>`).addTo(map);
}
}

function handleClusterMouseLeaveSimple() {
map.getCanvas().style.cursor = '';
if (currentHoverPopup) { currentHoverPopup.remove(); currentHoverPopup = null; }
}

// --- UI Update Functions ---
function updateActiveButton(timeRange) {
// *** FIXED: Use querySelectorAll to find buttons by class ***
console.log(`Updating active button for time range: ${timeRange}`);
timeRangeButtons.forEach(btn => {
if (btn.dataset.range === timeRange) {
console.log(` Activating button:`, btn);
btn.classList.add('active');
activeTimeRangeButton = btn; // Update the tracked active button
} else {
// console.log(` Deactivating button:`, btn);
btn.classList.remove('active');
}
});
}

function setLoadingState(isLoading) {
if (loadingOverlay) {
loadingOverlay.setAttribute('aria-hidden', String(!isLoading));
document.body.classList.toggle('loading', isLoading);
}
// *** FIXED: Disable buttons using the correct selector ***
timeRangeButtons.forEach(btn => {
btn.disabled = isLoading;
});
// Also disable logout button if it exists
const logoutBtn = document.getElementById('logout-button');
if (logoutBtn) logoutBtn.disabled = isLoading;
}

function showFlashMessage(message, duration = 3000, isError = false) {
if (!flashMessageElement) return;
flashMessageElement.textContent = message;
flashMessageElement.classList.toggle('error', isError);
flashMessageElement.classList.add('show');
if (flashTimeoutId) clearTimeout(flashTimeoutId);
flashTimeoutId = setTimeout(() => {
flashMessageElement.classList.remove('show');
flashTimeoutId = null;
}, duration);
}

function highlightListItem(artistId) {
if (!artistListContainer) return;
const currentActive = artistListContainer.querySelector('.artist-list-item.active');
if (currentActive) currentActive.classList.remove('active');
const listItem = artistListContainer.querySelector(`.artist-list-item[data-artist-id="${artistId}"]`);
if (listItem) {
listItem.classList.add('active');
listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
}

// --- List Interaction ---
function handleArtistListClick(event) {
const listItem = event.target.closest('.artist-list-item');
if (listItem && listItem.dataset.artistId) {
const artistId = listItem.dataset.artistId;
console.log(`List item clicked: ${artistId}`);
highlightListItem(artistId);
const artist = artistDataStore[artistId];
if (artist && isValidCoordinate(artist.lat) && isValidCoordinate(artist.lon)) {
const coords = [parseFloat(artist.lon), parseFloat(artist.lat)];
map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), FLY_TO_ZOOM_UNCLUSTERED), speed: FLY_TO_SPEED, essential: true });
setTimeout(() => {
if (map && map.getSource(ARTIST_SOURCE_ID)) {
if (currentClickPopup) currentClickPopup.remove();
const popupHTML = createArtistPopupContent(artist);
currentClickPopup = new mapboxgl.Popup({ offset: POPUP_OFFSET_POINT, closeButton: true, maxWidth: POPUP_MAX_WIDTH })
.setLngLat(coords).setHTML(popupHTML).addTo(map);
}
}, 600);
} else {
showFlashMessage("Artist location not available on the map.", 2000);
if (currentClickPopup) currentClickPopup.remove();
}
}
}

// --- HTML Generation ---
// (Keep existing functions createArtistListItem, createArtistPopupContent, createClusterPopupContent, addClusterPopupEventListeners - unchanged from v3.4)
function createArtistListItem(artist, rank) { const artistName = artist.name || 'Unknown Artist'; const artistId = artist.id; const imageUrl = artist.image_url || PLACEHOLDER_IMG_URL; const hasLocation = isValidCoordinate(artist.lat) && isValidCoordinate(artist.lon); const originText = hasLocation ? (artist.origin || 'Origin Unknown') : `${artist.origin || 'Origin Unknown'} (Location unavailable)`; let genresListText = 'No genre data'; if (Array.isArray(artist.genres) && artist.genres.length > 0) { genresListText = artist.genres.slice(0, 3).join(', '); if (artist.genres.length > 3) genresListText += '...'; } const genresTitle = Array.isArray(artist.genres) ? artist.genres.join(', ') : ''; let spotifyLinkHtml = ''; const spotifyUrl = artist.spotify_url || (artist.uri && artist.uri.includes(':') ? `https://open.spotify.com/$${artist.uri.split(':')[1]}/${artist.uri.split(':')[2]}` : null); if (spotifyUrl && spotifyUrl !== 'null') { spotifyLinkHtml = `<a href="${spotifyUrl}" target="_blank" title="Open ${artistName} on Spotify" class="spotify-play-icon" onclick="event.stopPropagation();" aria-label="Open ${artistName} on Spotify"><i class="fab fa-spotify" aria-hidden="true"></i></a>`; } return ` <div class="artist-list-item" data-artist-id="${artistId}" role="listitem" tabindex="0" aria-label="Artist: ${artistName}, Rank ${rank}"> <div class="artist-rank" aria-hidden="true">${rank}</div> <img src="${imageUrl}" class="artist-list-image" alt="Image of ${artistName}" onerror="this.onerror=null; this.src='${PLACEHOLDER_IMG_URL}'"> <div class="artist-info"> <span class="artist-name">${artistName}</span> <span class="artist-origin" title="${artist.origin || 'Origin Unknown'}"> <i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${originText} </span> <span class="artist-genres" title="${genresTitle}"> <i class="fas fa-tag" aria-hidden="true"></i> ${genresListText} </span> </div> <div class="artist-actions"> ${spotifyLinkHtml} </div> </div>`; }
function createArtistPopupContent(artist) { const artistName = artist.name || 'Unknown Artist'; const imageUrl = artist.image_url || PLACEHOLDER_IMG_URL; const originText = artist.origin || 'Origin unknown'; let spotifyUrl = artist.spotify_url; let genresText = 'N/A'; if (Array.isArray(artist.genres) && artist.genres.length > 0) { genresText = artist.genres.join(', '); } let spotifySectionHtml = ''; if (artist.uri && artist.uri.includes(':')) { const uriParts = artist.uri.split(':'); if (uriParts.length === 3 && ['artist', 'track', 'album'].includes(uriParts[1])) { const embedType = uriParts[1]; const embedId = uriParts[2]; const embedSrc = `https://open.spotify.com/embed/${embedType}/${embedId}?utm_source=generator&theme=0`; spotifySectionHtml = ` <div class="spotify-embed-container"> <iframe style="border-radius:12px" src="${embedSrc}" width="100%" height="80" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify Embed for ${artistName}"> </iframe> </div>`; } } if (!spotifySectionHtml) { if (!spotifyUrl && artist.uri && artist.uri.includes(':')) { const uriParts = artist.uri.split(':'); if (uriParts.length === 3) { spotifyUrl = `https://open.spotify.com/${uriParts[1]}/${uriParts[2]}`; } } if (spotifyUrl && spotifyUrl !== 'null') { spotifySectionHtml = ` <a href="${spotifyUrl}" target="_blank" class="popup-spotify-link"> <i class="fab fa-spotify" aria-hidden="true"></i> Listen on Spotify </a>`; } } return ` <div class="popup-header"> <img src="${imageUrl}" class="popup-artist-image" alt="${artistName}" onerror="this.onerror=null; this.src='${PLACEHOLDER_IMG_URL}'"> </div> <div class="popup-content"> <h3 class="popup-artist-name">${artistName}</h3> <div class="popup-artist-origin"> <i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${originText} </div> <div class="popup-artist-genres"> <i class="fas fa-tag" aria-hidden="true"></i> Genres: <small>${genresText}</small> </div> ${spotifySectionHtml} </div>`; }
function createClusterPopupContent(artists, totalCount) { let listHtml = artists.map((artist, index) => { const rank = artist.rank || index + 1; const imageUrl = artist.image_url || PLACEHOLDER_IMG_URL; const artistName = artist.name || 'Unknown Artist'; const spotifyUrl = artist.spotify_url || (artist.uri && artist.uri.includes(':') ? `https://open.spotify.com/${artist.uri.split(':')[1]}/${artist.uri.split(':')[2]}` : null); let spotifyLinkHtml = ''; if (spotifyUrl && spotifyUrl !== 'null') { spotifyLinkHtml = `<a href="${spotifyUrl}" target="_blank" class="cluster-spotify-link" title="Open ${artistName} on Spotify" onclick="event.stopPropagation();"><i class="fab fa-spotify"></i></a>`; } return ` <div class="cluster-artist-item" data-artist-id="${artist.id}" role="button" tabindex="0"> <span class="cluster-artist-rank">${rank}</span> <img src="${imageUrl}" class="cluster-artist-img" alt="${artistName}" onerror="this.onerror=null; this.src='${PLACEHOLDER_IMG_URL}'"> <div class="cluster-artist-info"> <span class="cluster-artist-name">${artistName}</span> ${spotifyLinkHtml} </div> </div> `; }).join(''); return ` <div class="popup-title">${totalCount} Artists</div> <div class="artist-cluster-list"> ${listHtml} </div> `; }
function addClusterPopupEventListeners(popupInstance, artistsInCluster) { const popupElement = popupInstance.getElement(); if (!popupElement) return; const items = popupElement.querySelectorAll('.cluster-artist-item'); items.forEach(item => { item.addEventListener('click', (e) => { const artistId = e.currentTarget.dataset.artistId; if (!artistId) return; console.log(`Cluster popup item clicked: ${artistId}`); const artist = artistDataStore[artistId]; if (artist && isValidCoordinate(artist.lat) && isValidCoordinate(artist.lon)) { const coords = [parseFloat(artist.lon), parseFloat(artist.lat)]; if (currentClickPopup) currentClickPopup.remove(); map.flyTo({ center: coords, zoom: FLY_TO_ZOOM_UNCLUSTERED + 1, speed: FLY_TO_SPEED, essential: true }); setTimeout(() => { if (map && map.getSource(ARTIST_SOURCE_ID)) { const popupHTML = createArtistPopupContent(artist); currentClickPopup = new mapboxgl.Popup({ offset: POPUP_OFFSET_POINT, closeButton: true, maxWidth: POPUP_MAX_WIDTH }).setLngLat(coords).setHTML(popupHTML).addTo(map); highlightListItem(artistId); } }, 600); } else { showFlashMessage("Selected artist location not available.", 2000); } }); }); }

// --- Image Processing ---
function createCircularImage(imageUrl, iconId) { return new Promise((resolve, reject) => { if (loadedImageIds.has(iconId) || (map && map.hasImage(iconId))) { resolve(iconId); return; } const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => { try { const canvas = document.createElement('canvas'); const size = ICON_SIZE_PX; canvas.width = size; canvas.height = size; const ctx = canvas.getContext('2d'); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true); ctx.closePath(); ctx.clip(); ctx.drawImage(img, 0, 0, size, size); if (ICON_BORDER_WIDTH_PX > 0) { ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - ICON_BORDER_WIDTH_PX / 2, 0, Math.PI * 2, true); ctx.closePath(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = ICON_BORDER_WIDTH_PX; ctx.stroke(); } const imageData = ctx.getImageData(0, 0, size, size); if (map && map.isStyleLoaded() && !map.hasImage(iconId)) { map.addImage(iconId, imageData, { sdf: false }); loadedImageIds.add(iconId); resolve(iconId); } else if (!map || !map.isStyleLoaded()) { console.warn(`Map not ready when trying to add image ${iconId}.`); resolve(iconId); } else { resolve(iconId); } } catch (error) { console.error(`Error processing image for ${iconId}:`, error); reject(error); } }; img.onerror = (error) => { console.warn(`Failed to load image URL: ${imageUrl} for icon ID: ${iconId}`); reject(new Error(`Image load failed`)); }; img.src = imageUrl; }); }

// --- Utility Functions ---
function generateIconId(artist) { const spotifyId = artist.uri ? artist.uri.split(':').pop() : null; if (spotifyId) return `artist-icon-${spotifyId}`; const safeName = (artist.name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(); return `artist-icon-${safeName}-${artist.id}`; }
function isValidCoordinate(coord) { const num = parseFloat(coord); return coord != null && !isNaN(num) && isFinite(num); }
function fitBoundsToGeoJSON(geojson) { if (!map || !geojson || !geojson.features || geojson.features.length === 0) return; try { const bounds = new mapboxgl.LngLatBounds(); geojson.features.forEach(feature => { if (feature.geometry && feature.geometry.type === 'Point' && feature.geometry.coordinates) { bounds.extend(feature.geometry.coordinates); } }); if (!bounds.isEmpty()) { map.fitBounds(bounds, { padding: calculatePadding(), maxZoom: CLUSTER_MAX_ZOOM + 1, duration: 1000, essential: true }); } } catch (error) { console.error("Error calculating or fitting map bounds:", error); } }
function calculatePadding(isPopupOpen = false) { const panelWidth = document.getElementById('artist-panel')?.offsetWidth || 0; const isMobile = window.innerWidth <= parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mobile-breakpoint') || '992px'); const defaultPadding = 50; const panelPadding = isMobile ? defaultPadding : Math.max(defaultPadding, panelWidth + 20); const popupPaddingIncrease = isPopupOpen ? 30 : 0; return { top: defaultPadding + popupPaddingIncrease, bottom: defaultPadding + 30, left: panelPadding, right: defaultPadding + popupPaddingIncrease }; }

// --- Document Ready ---
// The initializeApp function is called via DOMContentLoaded listener at the top.