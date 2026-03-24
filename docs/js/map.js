// =============================================================================
// map.js
// GreenSpacesMap — NYC Park Access
//
// Loads scored GeoJSON layers and renders them on a Leaflet map.
// Supports address search with H3 cell lookup for park access scores.
//
// Data pipeline:
//   01_download.R        -> raw data
//   01b_osm_parks.R      -> parks_unified.geojson
//   02_score.R           -> hex_scores_parks.geojson, nta_scores.geojson
//
// Address search tech stack:
//   NYC GeoSearch API    -> geocodes address to lat/lng
//   H3 JS library        -> converts lat/lng to H3 res 10 cell index
//   hexFeatureMap        -> in-memory lookup of cell index to score data
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
// -----------------------------------------------------------------------------
var map = L.map('map', {
  center:       [40.7484, -73.9857],
  zoom:         11,
  zoomControl:  true,
  tap:          true,
  tapTolerance: 15
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors © CARTO',
  subdomains:  'abcd',
  maxZoom:     19
}).addTo(map);

// -----------------------------------------------------------------------------
// Layer groups
// -----------------------------------------------------------------------------
var ntaLayer   = L.layerGroup().addTo(map);
var hexLayer   = L.layerGroup().addTo(map);
var parksLayer = L.layerGroup().addTo(map);

// -----------------------------------------------------------------------------
// In-memory lookup: h3_index -> feature properties
// Built when hex GeoJSON loads, used by address search
// -----------------------------------------------------------------------------
var hexFeatureMap = {};

function buildHexLookup(data) {
  data.features.forEach(function(f) {
    if (f.properties && f.properties.h3_index) {
      hexFeatureMap[f.properties.h3_index] = f.properties;
    }
  });
  console.log('H3 lookup map built:', Object.keys(hexFeatureMap).length, 'cells');
}

// -----------------------------------------------------------------------------
// Popup builders
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

function parkPopup(p) {
  return (
    '<div class="parks-popup">' +
      '<div class="park-name">' + (p.park_name || '') + '</div>' +
      '<div class="park-meta">' + (p.borough || '') + '</div>' +
      '<div class="park-meta">' + Math.round(p.area_sqm / 10000 * 10) / 10 + ' ha</div>' +
    '</div>'
  );
}

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
// Layers chained to render in correct order:
// NTA (bottom) -> Hex -> Parks -> Golf courses (top)
// -----------------------------------------------------------------------------

// 1. NTA scores
fetch('data/nta_scores.geojson')
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

    // 2. Hex scores
    return fetch('data/hex_scores_parks.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

    // Build lookup map for address search
    buildHexLookup(data);

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

    // 3. Parks display
    return fetch('data/parks_display.geojson');
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

    // 4. Golf courses
    return fetch('data/golf_courses.geojson');
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

// -----------------------------------------------------------------------------
// Address search
// Uses NYC GeoSearch API for autocomplete and geocoding
// Converts lat/lng to H3 cell using h3-js library
// Looks up score from hexFeatureMap built at load time
// -----------------------------------------------------------------------------
var searchInput    = document.getElementById('search-input');
var searchClear    = document.getElementById('search-clear');
var searchDropdown = document.getElementById('search-dropdown');
var resultCard     = document.getElementById('result-card');
var searchMarker   = null;
var searchDebounce = null;

// Geocode address using NYC Planning GeoSearch API
function geocodeAddress(address) {
  var url = 'https://geosearch.planninglabs.nyc/v2/autocomplete?text=' +
    encodeURIComponent(address) + '&size=5';
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) { return data.features || []; });
}

// Render autocomplete suggestions
function showSuggestions(features) {
  searchDropdown.innerHTML = '';

  if (features.length === 0) {
    searchDropdown.classList.remove('active');
    return;
  }

  features.forEach(function(f) {
    var item  = document.createElement('div');
    item.className = 'dropdown-item';

    var label = f.properties.label || '';
    var parts = label.split(',');
    var main  = parts[0] || label;
    var sub   = parts.slice(1).join(',').trim();

    item.innerHTML =
      '<span class="dropdown-item-icon">📍</span>' +
      '<span class="dropdown-item-text">' +
        '<div class="dropdown-item-label">' + main + '</div>' +
        (sub ? '<div class="dropdown-item-sub">' + sub + '</div>' : '') +
      '</span>';

    item.addEventListener('click', function() {
      selectResult(f);
    });

    searchDropdown.appendChild(item);
  });

  searchDropdown.classList.add('active');
}

// Handle address selection from dropdown
function selectResult(feature) {
  var coords = feature.geometry.coordinates; // GeoJSON is [lng, lat]
  var lng    = coords[0];
  var lat    = coords[1];
  var label  = feature.properties.label || '';

  // Hide dropdown, update input
  searchDropdown.classList.remove('active');
  searchInput.value = label.split(',')[0];
  searchClear.style.display = 'block';

  // Convert lat/lng to H3 res 10 cell index using h3-js
  var cellIndex = h3.latLngToCell(lat, lng, 10);

  // Look up pre-scored properties from in-memory map
  var props = hexFeatureMap[cellIndex];

  // Pan and zoom map to address
  map.setView([lat, lng], 16);

  // Remove previous search marker
  if (searchMarker) {
    map.removeLayer(searchMarker);
  }

  // Place marker at searched address
  searchMarker = L.circleMarker([lat, lng], {
    radius:      8,
    fillColor:   '#2d6a4f',
    fillOpacity: 1,
    color:       'white',
    weight:      2
  }).addTo(map);

  // Show result card
  showResultCard(label, props);
}

// Populate and show result card
function showResultCard(address, props) {
  var parts    = address.split(',');
  var mainAddr = parts[0] || address;
  var subAddr  = parts.slice(1, 3).join(',').trim();

  document.getElementById('result-address').textContent = mainAddr;
  document.getElementById('result-nta').textContent     = subAddr;

  if (props) {
    document.getElementById('result-park').textContent  = '🌳 ' + (props.nearest_park || 'Nearby park');
    document.getElementById('result-walk').textContent  = '~' + (props.walk_mins || '') + ' min walk';
    document.getElementById('result-grade').textContent = props.grade || '';
    document.getElementById('result-grade').style.color =
      GRADE_COLORS[props.grade] || '#1c1c1a';
  } else {
    document.getElementById('result-park').textContent  = 'No score data for this location';
    document.getElementById('result-walk').textContent  = '';
    document.getElementById('result-grade').textContent = '';
  }

  resultCard.classList.add('open');
}

// Debounced input handler - fires geocode after 300ms pause
searchInput.addEventListener('input', function() {
  var val = this.value.trim();
  searchClear.style.display = val ? 'block' : 'none';

  clearTimeout(searchDebounce);

  if (val.length < 3) {
    searchDropdown.classList.remove('active');
    return;
  }

  searchDebounce = setTimeout(function() {
    geocodeAddress(val).then(showSuggestions);
  }, 300);
});

// Clear search
searchClear.addEventListener('click', function() {
  searchInput.value = '';
  searchClear.style.display = 'none';
  searchDropdown.classList.remove('active');
  resultCard.classList.remove('open');
  if (searchMarker) {
    map.removeLayer(searchMarker);
    searchMarker = null;
  }
});

// Close dropdown on map interaction
map.on('click', function() {
  searchDropdown.classList.remove('active');
});

map.on('dragstart', function() {
  resultCard.classList.remove('open');
  searchDropdown.classList.remove('active');
});
