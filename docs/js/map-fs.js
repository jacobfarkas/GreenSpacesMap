// =============================================================================
// map-fs.js
// GreenSpacesMap — Flagship Park Access
//
// Default state: NTA layer visible and interactive, H3 hex loaded but hidden.
// Parks always visible. NTA/H3 are a toggle — either/or.
//
// Modes: Walk and Subway, switchable via bottom mode bar.
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
map.getPane('ntaPane').style.pointerEvents = 'auto';

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors © CARTO',
  subdomains:  'abcd',
  maxZoom:     19
}).addTo(map);

// -----------------------------------------------------------------------------
// Layer groups
// -----------------------------------------------------------------------------
var ntaLayer   = L.layerGroup().addTo(map);
var hexLayer   = L.layerGroup();
var parksLayer = L.layerGroup().addTo(map);

var hexVisible  = false;
var currentMode = 'walk';
var ntaGeoJSON  = null;

var walkHexData   = null;
var walkNtaData   = null;
var subwayHexData = null;
var subwayNtaData = null;

// -----------------------------------------------------------------------------
// Popup options — shared across all bindPopup calls
// -----------------------------------------------------------------------------
var POPUP_OPTS = { maxWidth: 280, autoPan: true, autoPanPaddingTopLeft: L.point(10, 250) };

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
  hexFeatureMap = {};
  parkCellMap   = {};
  data.features.forEach(function(f) {
    if (f.properties && f.properties.h3_index) {
      hexFeatureMap[f.properties.h3_index] = f.properties;
      var pName = f.properties.nearest_flagship;
      var hops  = f.properties.hops;
      if (pName && (hops === 0 || hops === 1) && !parkCellMap[pName]) {
        parkCellMap[pName] = f.properties.h3_index;
      }
    }
  });
  console.log('H3 lookup map built:', Object.keys(hexFeatureMap).length, 'cells');
}

// -----------------------------------------------------------------------------
// Popup builders
// -----------------------------------------------------------------------------
function hexPopupWalk(p) {
  var parkName = p.nearest_flagship || 'Nearby flagship park';
  var parkCell = parkCellMap[parkName];
  var parkLink = parkCell
    ? '<a href="#" class="park-link" onclick="event.preventDefault();panToCell(\'' + parkCell + '\')">🌳 ' + parkName + '</a>'
    : '🌳 ' + parkName;
  return (
    '<div class="park-popup">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:6px">' + (p.nta || '') + '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:2px">Closest flagship park nearby</div>' +
      parkLink +
      '<div style="font-size:12px;color:#555;margin-top:6px">~' + (p.walk_mins || '') + ' min walk</div>' +
      '<div style="font-weight:700;font-size:12px;margin-top:6px;margin-bottom:2px">Grade</div>' +
      '<div style="font-size:32px;font-weight:700;color:' + (GRADE_COLORS[p.grade] || '#1c1c1a') + '">' + (p.grade || '') + '</div>' +
    '</div>'
  );
}

function hexPopupSubway(p) {
  var stationName = p.nearest_station || 'Nearby station';
  var walkProps   = walkHexData ? walkHexData.features.find(function(f) {
    return f.properties.h3_index === p.h3_index;
  }) : null;
  var parkName    = (walkProps && walkProps.properties.nearest_flagship) || 'Nearby flagship park';
  var routeType   = p.route_type || '';
  var routeLabel  = routeType === 'transfer'     ? ' (1 transfer)'  :
                    routeType === 'direct'        ? ' (direct)'      :
                    routeType === 'at_park'       ? ' (at park)'     :
                    routeType === 'walk_fallback' ? ' (walk faster)' : '';
  return (
    '<div class="park-popup">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:6px">' + (p.nta || '') + '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:2px">Closest flagship park nearby</div>' +
      '<div style="font-size:13px;font-weight:500;color:#2d6a4f;margin-bottom:6px">🌳 ' + parkName + '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:2px">Nearest subway station</div>' +
      '<div style="font-size:13px;font-weight:500;color:#2d6a4f;margin-bottom:6px">🚇 ' + stationName + routeLabel + '</div>' +
      '<div style="font-size:12px;color:#555;margin-top:6px">~' + (p.total_mins || '') + ' min travel time</div>' +
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

function flagshipPopup(p) {
  var acres = p.acres ? Math.round(p.acres * 10) / 10 : '';
  return (
    '<div class="parks-popup">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:4px">⭐ ' + (p.park_name || '') + '</div>' +
      '<div style="font-size:12px;color:#555;margin-bottom:2px">Flagship Park</div>' +
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
// Layer loaders
// -----------------------------------------------------------------------------
function loadHexLayer(data, mode) {
  if (!data) return;
  buildHexLookup(data);
  var popupFn = mode === 'walk' ? hexPopupWalk : hexPopupSubway;
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
      layer.bindPopup(popupFn(f.properties), POPUP_OPTS);
    }
  }).addTo(hexLayer);
}

function loadNtaLayer(data) {
  if (!data) return;
  ntaGeoJSON = L.geoJSON(data, {
    style: function(f) {
      return hexVisible ? ntaStyleOutline() : ntaStyleColored(f.properties.grade);
    },
    pane: 'ntaPane',
    onEachFeature: function(f, layer) {
      layer.bindPopup(ntaPopup(f.properties), POPUP_OPTS);
    }
  }).addTo(ntaLayer);
}

// -----------------------------------------------------------------------------
// Mode switching — subway data loaded lazily on first switch
// -----------------------------------------------------------------------------
function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  document.getElementById('mode-walk').classList.toggle('active',   mode === 'walk');
  document.getElementById('mode-subway').classList.toggle('active', mode === 'subway');

  hexLayer.clearLayers();
  ntaLayer.clearLayers();
  hexFeatureMap = {};
  parkCellMap   = {};
  ntaGeoJSON    = null;

  if (mode === 'walk') {
    loadHexLayer(walkHexData, 'walk');
    loadNtaLayer(walkNtaData);
    if (hexVisible) { map.addLayer(hexLayer); }
    updateNtaStyle();
  } else {
    if (subwayHexData && subwayNtaData) {
      loadHexLayer(subwayHexData, 'subway');
      loadNtaLayer(subwayNtaData);
      if (hexVisible) { map.addLayer(hexLayer); }
      updateNtaStyle();
    } else {
      document.getElementById('mode-subway').textContent = '⏳ Loading...';
      fetch('data/hex_scores_flagship_subway.geojson')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          subwayHexData = data;
          return fetch('data/nta_scores_flagship_subway.geojson');
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          subwayNtaData = data;
          document.getElementById('mode-subway').textContent = '🚇 Subway';
          loadHexLayer(subwayHexData, 'subway');
          loadNtaLayer(subwayNtaData);
          if (hexVisible) { map.addLayer(hexLayer); }
          updateNtaStyle();
        })
        .catch(function(err) {
          document.getElementById('mode-subway').textContent = '🚇 Subway';
          console.error('Failed to load subway data:', err);
        });
    }
  }

  resultCard.classList.remove('open');
}

// -----------------------------------------------------------------------------
// Data loading — walk on startup, subway lazy, parks always
// -----------------------------------------------------------------------------
fetch('data/hex_scores_flagship_walk.geojson')
  .then(function(r) { return r.json(); })
  .then(function(data) {
    walkHexData = data;
    buildHexLookup(data);
    loadHexLayer(data, 'walk');
    return fetch('data/nta_scores_flagship_walk.geojson');
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    walkNtaData = data;
    loadNtaLayer(data);
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
        layer.bindPopup(parkPopup(f.properties), POPUP_OPTS);
      }
    }).addTo(parksLayer);
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
        layer.bindPopup(flagshipPopup(f.properties), POPUP_OPTS);
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
        layer.bindPopup(golfPopup(f.properties), POPUP_OPTS);
      }
    }).addTo(parksLayer);
  })
  .catch(function(err) {
    console.error('Error loading data:', err);
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
// Mode switcher buttons
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
  var modeWalk   = document.getElementById('mode-walk');
  var modeSubway = document.getElementById('mode-subway');
  if (modeWalk)   modeWalk.addEventListener('click',   function() { switchMode('walk');   });
  if (modeSubway) modeSubway.addEventListener('click', function() { switchMode('subway'); });
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

if (layersBtn)     layersBtn.addEventListener('click', openLayers);
if (layersClose)   layersClose.addEventListener('click', closeLayers);
if (layersOverlay) layersOverlay.addEventListener('click', closeLayers);

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
        if (sublayer.feature && sublayer.feature.properties.h3_index === cellIndex) {
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
    var item = document.createElement('div');
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

  // Auto-switch to block level if not already
  if (!hexVisible) {
    hexVisible = true;
    map.addLayer(hexLayer);
    updateNtaStyle();
    document.getElementById('toggle-nta-btn').classList.remove('active');
    document.getElementById('toggle-hex-btn').classList.add('active');
  }

  if (searchMarker) { map.removeLayer(searchMarker); }
  searchMarker = L.circleMarker([lat, lng], {
    radius: 8, fillColor: '#2d6a4f', fillOpacity: 1, color: 'white', weight: 2
  }).addTo(map);
  searchMarker.on('click', function() {
    resultCard.classList.remove('open');
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
    var isSubway  = currentMode === 'subway';
    var parkName  = isSubway
      ? (props.nearest_station  || 'Nearby station')
      : (props.nearest_flagship || 'Nearby flagship park');
    var parkCell  = parkCellMap[parkName];
    var timeLabel = isSubway
      ? '~' + (props.total_mins || '') + ' min total'
      : '~' + (props.walk_mins  || '') + ' min walk';
    var icon      = isSubway ? '🚇' : '🌳';
    var cardLabel = isSubway ? 'Nearest subway station' : 'Closest flagship park nearby';

    var parkEl = document.getElementById('result-park');
    parkEl.innerHTML =
      '<span style="font-size:11px;color:#888;display:block;margin-bottom:2px">' + cardLabel + '</span>' +
      '<a href="#" class="park-link" data-cell="' + (parkCell || '') + '">' + icon + ' ' + parkName + '</a>';

    var parkLink = parkEl.querySelector('.park-link');
    if (parkLink && parkCell) {
      parkLink.addEventListener('click', function(e) {
        e.preventDefault();
        panToCell(parkCell);
      });
    }

    document.getElementById('result-walk').textContent  = timeLabel;
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

map.on('popupopen', function() { resultCard.classList.remove('open'); });
map.on('click', function() { searchDropdown.classList.remove('active'); });
map.on('dragstart', function() {
  resultCard.classList.remove('open');
  searchDropdown.classList.remove('active');
});
