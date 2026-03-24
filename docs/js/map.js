// =============================================================================
// map.js
// GreenSpacesMap — NYC Park Access
//
// Loads three scored GeoJSON layers and renders them on a Leaflet map:
//   1. NTA scores       — neighborhood-level park access grades
//   2. Hex scores       — H3 res 10 cell-level park access grades
//   3. Parks display    — park polygons (dark green)
//   4. Golf courses     — excluded from scoring, pale green overlay
//
// Data files (relative to docs/):
//   ../data/nta_scores.geojson
//   ../data/hex_scores_parks.geojson
//   ../data/parks_display.geojson
//   ../data/golf_courses.geojson
// =============================================================================

// -----------------------------------------------------------------------------
// Grade color config
// A-F scale matching the scoring rubric in 02_score.R
// -----------------------------------------------------------------------------
var GRADE_COLORS = {
  'A': '#1d6fa4',  // blue        - under 5 min walk
  'B': '#74b3ce',  // light blue  - 5 to 10 min walk
  'C': '#f5c842',  // yellow      - 10 to 15 min walk
  'D': '#f07c1e',  // orange      - 15 to 20 min walk
  'F': '#d7263d'   // red         - over 20 min walk
};

// -----------------------------------------------------------------------------
// Map initialisation
// Center on NYC, zoom to show all 5 boroughs
// -----------------------------------------------------------------------------
var map = L.map('map', {
  center:       [40.7484, -73.9857],
  zoom:         11,
  zoomControl:  true,
  tap:          true,      // enable touch tap events on mobile
  tapTolerance: 15         // pixels of tolerance for touch taps
});

// Base tiles - CartoDB light style, clean and minimal
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors © CARTO',
  subdomains:  'abcd',
  maxZoom:     19
}).addTo(map);

// -----------------------------------------------------------------------------
// Layer groups
// Defined separately so layer toggles can add/remove them independently
// -----------------------------------------------------------------------------
var ntaLayer   = L.layerGroup().addTo(map);
var hexLayer   = L.layerGroup().addTo(map);
var parksLayer = L.layerGroup().addTo(map);

// -----------------------------------------------------------------------------
// Helper: build hex cell popup HTML
// -----------------------------------------------------------------------------
function hexPopup(p) {
  return (
    '<div class="park-popup">' +
      '<div class="park-name">'  + (p.nearest_park || 'Nearby park') + '</div>' +
      '<div class="nta-name">Neighborhood: ' + (p.nta || '') + '</div>' +
      '<div class="cell-id">Cell: ' + (p.h3_index || '') + '</div>' +
      '<div class="walk-time">~' + (p.walk_mins || '') + ' min walk</div>' +
      '<div class="grade">' + (p.grade || '') + '</div>' +
    '</div>'
  );
}

// -----------------------------------------------------------------------------
// Helper: build NTA popup HTML
// -----------------------------------------------------------------------------
function ntaPopup(p) {
  return (
    '<div class="nta-popup">' +
      '<div class="nta-name">' + (p.nta || '') + '</div>' +
      '<div class="nta-meta">Cells scored: ' + (p.cell_count || '') + '</div>' +
      '<div class="nta-meta">A+B grade cells: ' + (p.pct_ab || 0) + '%</div>' +
      '<div class="nta-meta">A grade cells: ' + (p.pct_a || 0) + '%</div>' +
      '<div class="nta-meta">F grade cells: ' + (p.pct_f || 0) + '%</div>' +
      '<div class="nta-grade">Neighborhood grade: ' + (p.grade || '') + '</div>' +
    '</div>'
  );
}

// -----------------------------------------------------------------------------
// Helper: build park popup HTML
// -----------------------------------------------------------------------------
function parkPopup(p) {
  return (
    '<div class="parks-popup">' +
      '<div class="park-name">' + (p.park_name || '') + '</div>' +
      '<div class="park-meta">' + (p.borough || '') + '</div>' +
      '<div class="park-meta">' + Math.round(p.area_sqm / 10000 * 10) / 10 + ' ha</div>' +
    '</div>'
  );
}

// -----------------------------------------------------------------------------
// Helper: build golf course popup HTML
// -----------------------------------------------------------------------------
function golfPopup(p) {
  return (
    '<div class="parks-popup">' +
      '<div class="park-name">' + (p.golf_name || 'Golf Course') + '</div>' +
      '<div class="park-meta">Golf course — not public access</div>' +
    '</div>'
  );
}

// -----------------------------------------------------------------------------
// Data loading
// Layers are chained so they render in the correct order:
// NTA (bottom) -> Hex -> Parks -> Golf courses (top)
// -----------------------------------------------------------------------------

// 1. NTA scores - neighborhood level, semi-transparent fill
fetch('/data/nta_scores.geojson')
  .then(function(r) { return r.json(); })
  .then(function(data) {

    L.geoJSON(data, {
      style: function(f) {
        return {
          fillColor:   GRADE_COLORS[f.properties.grade] || '#d7263d',
          fillOpacity: 0.3,
          color:       '#ffffff',
          weight:      1.5,
          opacity:     0.8
        };
      },
      onEachFeature: function(f, layer) {
        layer.bindPopup(ntaPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(ntaLayer);

    // 2. Hex scores - cell level, on top of NTA
    return fetch('/data/hex_scores_parks.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

    L.geoJSON(data, {
      style: function(f) {
        return {
          fillColor:   GRADE_COLORS[f.properties.grade] || '#d7263d',
          fillOpacity: 0.7,
          color:       '#000000',
          weight:      0.4,
          opacity:     0.4
        };
      },
      onEachFeature: function(f, layer) {
        layer.bindPopup(hexPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(hexLayer);

    // 3. Parks display - solid dark green, on top of hex
    return fetch('/data/parks_display.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

    L.geoJSON(data, {
      style: {
        fillColor:   '#2d6a4f',
        fillOpacity: 0.85,
        color:       '#1a3d2b',
        weight:      1
      },
      onEachFeature: function(f, layer) {
        layer.bindPopup(parkPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(parksLayer);

    // 4. Golf courses - pale green overlay, on top of parks
    return fetch('/data/golf_courses.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

    L.geoJSON(data, {
      style: {
        fillColor:   '#c8e6c9',
        fillOpacity: 0.7,
        color:       '#a5d6a7',
        weight:      0.5
      },
      onEachFeature: function(f, layer) {
        layer.bindPopup(golfPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(parksLayer);

  })
  .catch(function(err) {
    console.error('Error loading GeoJSON data:', err);
  });

// -----------------------------------------------------------------------------
// Layer toggle event listeners
// -----------------------------------------------------------------------------
document.getElementById('toggle-nta').addEventListener('change', function() {
  if (this.checked) { map.addLayer(ntaLayer);   } else { map.removeLayer(ntaLayer);   }
});

document.getElementById('toggle-hex').addEventListener('change', function() {
  if (this.checked) { map.addLayer(hexLayer);   } else { map.removeLayer(hexLayer);   }
});

document.getElementById('toggle-parks').addEventListener('change', function() {
  if (this.checked) { map.addLayer(parksLayer); } else { map.removeLayer(parksLayer); }
});

// -----------------------------------------------------------------------------
// Bottom sheet toggle (mobile)
// -----------------------------------------------------------------------------
var layersBtn     = document.getElementById('layers-btn');
var layersPanel   = document.getElementById('layers-panel');
var layersOverlay = document.getElementById('layers-overlay');
var layersClose   = document.getElementById('layers-close');

function openLayers() {
  layersPanel.classList.add('open');
  layersOverlay.classList.add('active');
}

function closeLayers() {
  layersPanel.classList.remove('open');
  layersOverlay.classList.remove('active');
}

layersBtn.addEventListener('click', openLayers);
layersClose.addEventListener('click', closeLayers);
layersOverlay.addEventListener('click', closeLayers);
