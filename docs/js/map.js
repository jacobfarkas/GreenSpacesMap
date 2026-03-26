// =============================================================================
// map.js
// GreenSpacesMap — NYC Park Access
//
// Default state: NTA layer visible and interactive, H3 hex loaded but hidden.
// Parks always visible. NTA/H3 are a toggle — either/or.
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

map.createPane('parksPane');
map.getPane('parksPane').style.zIndex = 450;

map.createPane('ntaPane');
map.getPane('ntaPane').style.zIndex = 250;
map.getPane('ntaPane').style.pointerEvents = 'auto'; // NTA interactive on load

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors © CARTO',
  subdomains:  'abcd',
  maxZoom:     19
}).addTo(map);

// -----------------------------------------------------------------------------
// Layer groups
// NTA and parks added to map on load. Hex is NOT added until user selects it.
// -----------------------------------------------------------------------------
var ntaLayer   = L.layerGroup().addTo(map);
var hexLayer   = L.layerGroup();              // not added to map on load
var parksLayer = L.layerGroup().addTo(map);

// -----------------------------------------------------------------------------
// State
// hexVisible = false on load (NTA is the default view)
// -----------------------------------------------------------------------------
var hexVisible = false;
var ntaGeoJSON = null;

// -----------------------------------------------------------------------------
// NTA style functions
// -----------------------------------------------------------------------------
function ntaStyleOutline() {
  return {
    fillColor:   '#000000',
    fillOpacity: 0,
    color:       '#666666',
    weight:      2,
    opacity:     0.8,
    pane:        'ntaPane'
  };
}

function ntaStyleColored(grade) {
  return {
    fillColor:   GRADE_COLORS[grade] || '#d7263d',
    fillOpacity: 0.5,
    color:       '#ffffff',
    weight:      1.5,
    opacity:     0.8,
    pane:        'ntaPane'
  };
}

function updateNtaStyle() {
  if (!ntaGeoJSON) return;
  if (hexVisible) {
    map.getPane('ntaPane').style.pointerEvents = 'none';
    ntaGeoJSON.eachLayer(function(layer) {
      layer.setStyle(ntaStyleOutline());
    });
  } else {
    map.getPane('ntaPane').style.pointerEvents = 'auto';
    ntaGeoJSON.eachLayer(function(layer) {
      var grade = layer.feature.properties.grade;
      layer.setStyle(ntaStyleColored(grade));
    });
  }
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
  var parkName = p.nearest_park || 'Nearby park';
  var parkCell = parkCellMap[parkName];
  var parkLink = parkCell
    ? '<a href="#" class="park-link" onclick="event.preventDefault();panToCell(\'' + parkCell + '\')">🌳 ' + parkName + '</a>'
    : '🌳 ' + parkName;
  return (
    '<div class="park-popup">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:6px">' + (p.nta || '') + '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:2px">Closest park nearby</div>' +
      parkLink +
      '<div style="font-size:12px;color:#555;margin-top:6px">~' + (p.walk_mins || '') + ' min walk</div>' +
      '<div style="font-size:10px;color:#aaa;margin-top:3px;font-family:monospace">' + (p.h3_index || '') + '</div>' +
      '<div style="font-weight:700;font-size:12px;margin-top:6px;margin-bottom:2px">Grade</div>' +
      '<div style="font-size:32px;font-weight:700;color:' + (GRADE_COLORS[p.grade] || '#1c1c1a') + '">' + (p.grade || '') + '</div>' +
    '</div>'
  );
}

function ntaPopup(p) {
  return (
    '<div class="nta-popup">' +
      '<div style="font-weight:700;font-size:15px;margin-bottom:8px">' + (p.nta || '') + '</div>' +
      '<div style="font-size:12px;color:#555;margin-bottom:6px">Cells scored: ' + (p.cell_count || '') + '</div>' +
      '<div style="font-weight:700;font-size:12px;margin-bottom:2px">Grade</div>' +
      '<div style="font-size:32px;font-weight:700;color:' + (GRADE_COLORS[p.grade] || '#1c1c1a') + '">' + (p.grade || '') + '</div>' +
    '</div>'
  );
}

function parkPopup(p) {
  var acres = p.area_sqm ? Math.round(p.area_sqm / 4047 * 10) / 10 : '';
  return (
    '<div class="parks-popup">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:4px">' + (p.park_name || '') + '</div>' +
      '<div style="font-size:12px;color:#555;margin-bottom:2px">Park</div>' +
      '<div style="font-size:12px;color:#555">Size: ' + acres + ' acres</div>' +
    '</div>'
  );
}

function golfPopup(p) {
  return (
    '<div class="parks-popup">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:4px">' + (p.golf_name || 'Golf Course') + '</div>' +
      '<div style="font-size:12px;color:#555">Golf Course</div>' +
    '</div>'
  );
}

// -----------------------------------------------------------------------------
// Data loading
// NTA loads first and is visible. Hex loads into memory but not added to map.
// Parks always load and are always visible.
// -----------------------------------------------------------------------------
fetch('data/nta_scores.geojson')
  .then(function(r) { return r.json(); })
  .then(function(data) {
    ntaGeoJSON = L.geoJSON(data, {
      style: function(f) {
        return ntaStyleColored(f.properties.grade); // colored on load
      },
      pane: 'ntaPane',
      onEachFeature: function(f, layer) {
        layer.bindPopup(ntaPopup(f.properties), { maxWidth: 280 });
      }
    }).addTo(ntaLayer);

    return fetch('data/hex_scores_parks.geojson');
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
    // hexLayer is NOT added to map here — stays hidden until user toggles

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
// NTA / H3 toggle buttons
// -----------------------------------------------------------------------------
document.getElementById('toggle-nta-btn').addEventListener('click', function() {
  if (hexVisible) {
    hexVisible = false;
    map.removeLayer(hexLayer);
    updateNtaStyle();
    document.getElementById('toggle-nta-btn').classList.add('active');
    document.getElementById('toggle-hex-btn').classList.remove('active');
  }
});

document.getElementById('toggle-hex-btn').addEventListener('click', function() {
  if (!hexVisible) {
    hexVisible = true;
    map.addLayer(hexLayer);
    updateNtaStyle();
    document.getElementById('toggle-nta-btn').classList.remove('active');
    document.getElementById('toggle-hex-btn').classList.add('active');
  }
});

// -----------------------------------------------------------------------------
// Bottom sheet toggle (mobile)
// -----------------------------------------------------------------------------
var layersBtn     = document.getElementById('layers-btn');
var layersPanel   = document.getElementById('layers-panel');
var layersOverlay = document.getElementById('layers-overlay');
var layersClose   = document.getElementById('layers-close');

function openLayers()  { layersPanel.classList.add('open');    layersOverlay.classList.add('active');    }
function closeLayers() { layersPanel.classList.remove('open'); layersOverlay.classList.remove('active'); }

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
  map.setView([center[0], center[1]], 16);

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
  if (features.length === 0) { searchDropdown.classList.remove('active'); return; }
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
    item.addEventListener('click', function() { selectResult(f); });
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
    radius: 8, fillColor: '#2d6a4f', fillOpacity: 1, color: 'white', weight: 2
  }).addTo(map);
  searchMarker.on('click', function() { panToCell(cellIndex); });

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
      '<span style="font-size:11px;color:#888;display:block;margin-bottom:2px">Closest park nearby</span>' +
      '<a href="#" class="park-link" data-cell="' + (parkCell || '') + '">🌳 ' + parkName + '</a>';

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
  if (val.length < 3) { searchDropdown.classList.remove('active'); return; }
  searchDebounce = setTimeout(function() { geocodeAddress(val).then(showSuggestions); }, 300);
});

searchClear.addEventListener('click', function() {
  searchInput.value = '';
  searchClear.style.display = 'none';
  searchDropdown.classList.remove('active');
  resultCard.classList.remove('open');
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
});

map.on('click', function() { searchDropdown.classList.remove('active'); });
map.on('dragstart', function() {
  resultCard.classList.remove('open');
  searchDropdown.classList.remove('active');
});
