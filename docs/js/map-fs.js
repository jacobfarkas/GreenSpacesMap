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
//   01c_tree_filter.R    -> parks_unified_filtered.geojson
//   02_score.R           -> hex_scores_parks.geojson, nta_scores.geojson
//
// Address search tech stack:
//   NYC GeoSearch API v2 -> geocodes address to lat/lng
//   H3 JS library        -> converts lat/lng to H3 res 10 cell index
//   hexFeatureMap        -> in-memory lookup of cell index to score data
//   parkCellMap          -> in-memory lookup of park name to cell index
//
// NTA layer behavior:
//   - When hex layer is visible: NTA shows white outline only (no fill)
//   - When hex layer is hidden: NTA shows grade color fill
// =============================================================================

// -----------------------------------------------------------------------------
// Grade color config
// -----------------------------------------------------------------------------
var GRADE_COLORS = {
  'A': '#1d6fa4',
  'B': '#74b3ce',
  'C': '#f5c842',
  'D': '#f07c1e',
  'F': '#d7263d'
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

// Custom pane for parks - always renders above hex cells
map.createPane('parksPane');
map.getPane('parksPane').style.zIndex = 450;

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

// Track hex visibility for NTA style switching
var hexVisible = true;

// Store NTA geojson layer reference for re-styling
var ntaGeoJSON = null;

// -----------------------------------------------------------------------------
// NTA style functions
// Two modes: outline-only (when hex visible) and colored fill (when hex hidden)
// -----------------------------------------------------------------------------
function ntaStyleOutline() {
  return {
    fillColor:   '#000000',
    fillOpacity: 0,           // no fill - transparent
    color:       '#ffffff',   // white outline
    weight:      1.5,
    opacity:     0.8
  };
}

function ntaStyleColored(grade) {
  return {
    fillColor:   GRADE_COLORS[grade] || '#d7263d',
    fillOpacity: 0.5,
    color:       '#ffffff',
    weight:      1.5,
    opacity:     0.8
  };
}

function updateNtaStyle() {
  if (!ntaGeoJSON) return;
  ntaGeoJSON.eachLayer(function(layer) {
    if (hexVisible) {
      layer.setStyle(ntaStyleOutline());
    } else {
      var grade = layer.feature.properties.grade;
      layer.setStyle(ntaStyleColored(grade));
    }
  });
}

// -----------------------------------------------------------------------------
// In-memory lookups
// -----------------------------------------------------------------------------
var hexFeatureMap = {};
var parkCellMap   = {};

function buildHexLookup(data) {
  data.features.forEach(function(f) {
    if (f.properties && f.properties.h3_index) {
      hexFeatureMap[f.properties.h3_index] = f.properties;
      var pName = f.properties.nearest_park;
      var hops  = f.properties.hops;
      if (pName && (hops === 0 || hops === 1) && !parkCellMap[pName]) {
        parkCellMap[pName] = f.properties.h3_index;
      }
    }
  });
  console.log('H3 lookup map built:', Object.keys(hexFeatureMap).length, 'cells');
  console.log('Park cell map built:', Object.keys(parkCellMap).length, 'parks');
}

// -----------------------------------------------------------------------------
// Popup builders
// -----------------------------------------------------------------------------
function hexPopup(p) {
  var parkName = p.nearest_flagship || 'Nearby Flagship Park';
  var parkCell = parkCellMap[parkName];
  var parkLink = parkCell
    ? '<a href="#" class="park-link" onclick="event.preventDefault();panToCell(\'' + parkCell + '\')">🌳 ' + parkName + '</a>'
    : '🌳 ' + parkName;

  return (
    '<div class="park-popup">' +
      '<div class="park-name" style="font-weight:700;font-size:14px">' + (p.nta || '') + '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:2px;margin-top:6px">Closest park nearby</div>' +
      parkLink +
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
// -----------------------------------------------------------------------------

// 1. NTA scores
fetch('data/nta_scores_flagship_walk.geojson')
  .then(function(r) { return r.json(); })
  .then(function(data) {

    // Store reference so we can re-style on hex toggle
    ntaGeoJSON = L.geoJSON(data, {
      style: function(f) {
        // Initial style - outline only since hex is visible on load
        return ntaStyleOutline();
      },
      onEachFeature: function(f, layer) {
        layer.bindPopup(ntaPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(ntaLayer);

    // 2. Hex scores
    return fetch('data/hex_scores_flagship_walk.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

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
    // 3. All parks - dark green, no gold border
return fetch('data/parks_display.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

    L.geoJSON(data, {
      style: {
        fillColor:   '#2d6a4f',
        fillOpacity: 0.85,
        color:       '#1a3d2b',
        weight:      1,
        pane:        'parksPane'
      },
      onEachFeature: function(f, layer) {
        layer.bindPopup(parkPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(parksLayer);

    // 3b. Flagship parks - gold border on top
    return fetch('data/flagship_display.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {

    L.geoJSON(data, {
      style: {
        fillColor:   '#2d6a4f',
        fillOpacity: 0.9,
        color:       '#d4a017',
        weight:      2.5,
        pane:        'parksPane'
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
        weight:      0.5,
        pane:        'parksPane'
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
// NTA style switches based on hex visibility
// -----------------------------------------------------------------------------
document.getElementById('toggle-nta').addEventListener('change', function() {
  if (this.checked) {
    map.addLayer(ntaLayer);
  } else {
    map.removeLayer(ntaLayer);
  }
});

document.getElementById('toggle-hex').addEventListener('change', function() {
  if (this.checked) {
    hexVisible = true;
    map.addLayer(hexLayer);
  } else {
    hexVisible = false;
    map.removeLayer(hexLayer);
  }
  // Update NTA style to reflect new hex visibility
  updateNtaStyle();
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
// Pan to H3 cell and open its popup
// -----------------------------------------------------------------------------
function panToCell(cellIndex) {
  var props = hexFeatureMap[cellIndex];
  if (!props) return;

  var center = h3.cellToLatLng(cellIndex);
  var lat    = center[0];
  var lng    = center[1];

  map.setView([lat, lng], 16);

  hexLayer.eachLayer(function(layer) {
    if (layer.eachLayer) {
      layer.eachLayer(function(sublayer) {
        if (sublayer.feature &&
            sublayer.feature.properties.h3_index === cellIndex) {
          sublayer.openPopup();
        }
      });
    }
  });
}

// -----------------------------------------------------------------------------
// Address search
// -----------------------------------------------------------------------------
var searchInput    = document.getElementById('search-input');
var searchClear    = document.getElementById('search-clear');
var searchDropdown = document.getElementById('search-dropdown');
var resultCard     = document.getElementById('result-card');
var searchMarker   = null;
var searchDebounce = null;

function geocodeAddress(address) {
  var url = 'https://geosearch.planninglabs.nyc/v2/autocomplete?text=' +
    encodeURIComponent(address) + '&size=5';
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) { return data.features || []; });
}

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

function selectResult(feature) {
  var coords = feature.geometry.coordinates;
  var lng    = coords[0];
  var lat    = coords[1];
  var label  = feature.properties.label || '';

  searchDropdown.classList.remove('active');
  searchInput.value = label.split(',')[0];
  searchClear.style.display = 'block';

  var cellIndex = h3.latLngToCell(lat, lng, 10);
  var props     = hexFeatureMap[cellIndex];

  map.setView([lat, lng], 16);

  if (searchMarker) { map.removeLayer(searchMarker); }

  searchMarker = L.circleMarker([lat, lng], {
    radius:      8,
    fillColor:   '#2d6a4f',
    fillOpacity: 1,
    color:       'white',
    weight:      2
  }).addTo(map);

  searchMarker.on('click', function() {
    panToCell(cellIndex);
  });

  showResultCard(label, props);
}

function showResultCard(address, props) {
  var parts    = address.split(',');
  var mainAddr = parts[0] || address;
  var subAddr  = parts.slice(1, 3).join(',').trim();

  document.getElementById('result-address').textContent = mainAddr;
  document.getElementById('result-nta').textContent     = subAddr;

  if (props) {
    var parkName = props.nearest_park || 'Nearby park';
    var parkCell = parkCellMap[parkName];

    var parkEl = document.getElementById('result-park');
    parkEl.innerHTML =
      '<span style="font-size:11px;color:#888;display:block;margin-bottom:2px">' +
        'Closest park nearby' +
      '</span>' +
      '<a href="#" class="park-link" data-cell="' + (parkCell || '') + '">' +
        '🌳 ' + parkName +
      '</a>';

    var parkLink = parkEl.querySelector('.park-link');
    if (parkLink && parkCell) {
      parkLink.addEventListener('click', function(e) {
        e.preventDefault();
        panToCell(parkCell);
      });
    }

    document.getElementById('result-walk').textContent  = '~' + (props.walk_mins || '') + ' min walk';
    document.getElementById('result-grade').textContent = props.grade || '';
    document.getElementById('result-grade').style.color = GRADE_COLORS[props.grade] || '#1c1c1a';

  } else {
    document.getElementById('result-park').innerHTML    = 'No score data for this location';
    document.getElementById('result-walk').textContent  = '';
    document.getElementById('result-grade').textContent = '';
  }

  resultCard.classList.add('open');
}

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

map.on('click', function() {
  searchDropdown.classList.remove('active');
});

map.on('dragstart', function() {
  resultCard.classList.remove('open');
  searchDropdown.classList.remove('active');
});
