// map.js
// MapLibre GL initialization and map rendering functions.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

// Initial map view
const MAP_CENTER = [-74, 40.7];
const MAP_ZOOM   = 9.5;

// GeoJSON property used for choropleth coloring on recommendations
const SCORE_PROPERTY = "final_score";

// Epsilon to guarantee strictly ascending interpolate stops
const CHOROPLETH_EPSILON = 1e-9;

// stops: 5 → (min,p25,med,p75,max) ramp;  stops: 3 → (min,med,max) ramp
const CHOROPLETH_MODES = [
  {
    id: "score",   label: "Score",      col: "final_score", stops: 5,
    colors: ["#ff5571", "#ff9886", "#fffef2", "#7eff43", "#18f197"],
  },
  {
    id: "rent",    label: "Rent",       col: "rent_knn",    stops: 5,
    colors: ["#003ab8", "#0044ff", "#167bff", "#33cfff", "#ffffff"],
  },
  {
    id: "sqft",    label: "Sqft",       col: "sqft",        stops: 5,
    colors: ["#00575a", "#0098b3", "#00c1cf", "#0dffd7", "#ffffff"],
  },
  {
    id: "built",   label: "Built Year", col: "built_year",  stops: 5,
    colors: ["#6e2300", "#b93500", "#ff5917", "#ff985d", "#ffffff"],
  },
  {
    id: "stories", label: "Stories",    col: "bld_story",   stops: 5,
    colors: ["#630070", "#9300a7", "#f713ff", "#ff75ff", "#ffffff"],
  },
];
const DEFAULT_CHOROPLETH_MODE_ID = "score";

// fitBounds padding (px) for each view
const FIT_PADDING_SINGLE          = 120;  // one property during rating
const FIT_PADDING_NEIGHBORHOODS   = 40;   // all neighborhoods
const FIT_PADDING_RECOMMENDATIONS = 40;   // top-N results

// Max zoom when fitting to a single property (prevents zooming into one building footprint)
const SINGLE_PROP_MAX_ZOOM = 13;

// Speed multiplier for fitBounds during survey step (faster transitions between properties)
const SINGLE_PROP_FIT_SPEED = 4;

// Property layer paint values (non-color)
const PROP_FILL_OPACITY        = 1;
const PROP_CIRCLE_RADIUS       = 2;
const PROP_CIRCLE_STROKE_WIDTH = 1.5;
const PROP_CIRCLE_OPACITY      = 0.5;

// Neighborhood layer paint values (non-color)
const NEIGHBORHOOD_FILL_OPACITY           = 0.06;
const NEIGHBORHOOD_LINE_WIDTH             = 1.2;
const NEIGHBORHOOD_LINE_OPACITY           = 0.75;
const NEIGHBORHOOD_SELECTED_FILL_OPACITY  = 0.4;

// Dark / bright color pairs for all JS-managed map elements.
// _c() returns the right set based on the active basemap style.
const _DARK_COLORS = {
  neighborhood: "#63adf2",
  singleProp:   "#63adf2",
  fillOutline:  "#ffffff",
  circleStroke: "#ffffff",
  pinLine:      "#ffffff",
  pinCircle:    "#ff3333",
};
const _BRIGHT_COLORS = {
  neighborhood: "#1a6bc0",
  singleProp:   "#1a6bc0",
  fillOutline:  "#1a1a2e",
  circleStroke: "#1a1a2e",
  pinLine:      "#222233",
  pinCircle:    "#cc2222",
};
// Evaluated at call time so it always reflects the current style
function _c() {
  return (typeof _currentStyleUrl !== "undefined" && _currentStyleUrl === STYLE_BRIGHT)
    ? _BRIGHT_COLORS
    : _DARK_COLORS;
}

// Zoom level at which recommendations switch from circles (zoomed out)
// to polygon fills (zoomed in)
const RECOMMENDATIONS_POLYGON_MIN_ZOOM = 11;

// Fields shown in the hover tooltip for recommendation properties
// (in display order; keys must match GeoJSON property names from nyc_units)
const TOOLTIP_FIELDS = [
  { key: "rent_knn",      label: "Rent" },
  { key: "sqft",          label: "Sqft" },
  { key: "livingroomnum", label: "Living Rooms" },
  { key: "bedroomnum",    label: "Bedrooms" },
  { key: "bathroomnum",   label: "Bathrooms" },
  { key: "built_year",    label: "Built Year" },
  { key: "bld_story",     label: "Stories" },
];

//--------------------------------------------------------------------
// Map instance
//--------------------------------------------------------------------
const map = new maplibregl.Map({
  container: "map",
  style:     "assets/js/style.json",
  center:    MAP_CENTER,
  zoom:      MAP_ZOOM,
  minZoom:   9,
});

window.map = map;

// Shared hover popup instance for recommendation tooltips
let _hoverPopup = null;

// Store last recommendation GeoJSON for mode switching
let _currentRecommendationsGeojson = null;
let _activeChoroplethModeId = DEFAULT_CHOROPLETH_MODE_ID;

// Whether the general empty-map-click handler has been registered
let _mapEmptyClickAttached = false;

// MapLibre Marker used for the selected-property pin (recommendation listing click)
let _selectedPropMarker = null;

// MapLibre Marker used for the survey step (rating each property)
let _surveyPropMarker    = null;  // legacy; kept for clearSurveyPin compatibility
let _allSurveyPinMarkers = [];    // all 10 survey pins shown simultaneously

// Survey-step state for style-switch re-apply
let _surveyProperties       = null;
let _currentSurveyActiveIdx = 0;

// Hovered neighborhood feature id (for feature-state hover effect)
let _hoveredNeighborhoodId = null;

// Basemap style URLs and current active style
const STYLE_DARK   = "assets/js/style.json";
const STYLE_BRIGHT = "assets/js/style_bright.json";
let _currentStyleUrl = STYLE_DARK;

// Active view tracker — used to re-apply layers after a basemap style switch
let _activeView           = null;   // "neighborhoods" | "single" | "recommendations"
let _neighborhoodsGeojson = null;
let _singlePropertyObj    = null;

//--------------------------------------------------------------------
// Source / layer ids — survey step (all 10 properties shown at once)
//--------------------------------------------------------------------
const surveyPropertiesSrcId    = "survey-properties";
const surveyPropertiesPtSrcId  = "survey-properties-points";
const surveyPropertiesFillId   = "survey-properties-fill";
const surveyPropertiesCircleId = "survey-properties-circle";

//--------------------------------------------------------------------
// Source / layer ids — properties
//--------------------------------------------------------------------
const propertiesSourceId        = "properties";
const propertiesFillId          = "properties-fill";
const propertiesCircleId        = "properties-circle";
const recommendationsPointSrcId = "recommendations-points";

// Selected-property highlight (red fill, from listing card click)
const selectedPropSrcId  = "selected-property";
const selectedPropFillId = "selected-property-fill";

//--------------------------------------------------------------------
// Source / layer ids — neighborhoods
//--------------------------------------------------------------------
const neighborhoodSourceId       = "neighborhoods";
const neighborhoodFillId         = "neighborhoods-fill";
const neighborhoodOutlineId      = "neighborhoods-outline";
const neighborhoodSelectedSrcId  = "neighborhood-selected";
const neighborhoodSelectedFillId = "neighborhood-selected-fill";

//--------------------------------------------------------------------
// clearNeighborhoodLayer
//--------------------------------------------------------------------
function clearNeighborhoodLayer() {
  [neighborhoodSelectedFillId, neighborhoodOutlineId, neighborhoodFillId].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  [neighborhoodSelectedSrcId, neighborhoodSourceId].forEach(id => {
    if (map.getSource(id)) map.removeSource(id);
  });
  _hoveredNeighborhoodId = null;
  map.getCanvas().style.cursor = "";
}

//--------------------------------------------------------------------
// clearAllSources  (called from main.js on reset)
//--------------------------------------------------------------------
function clearAllSources() {
  clearNeighborhoodLayer();
  clearSurveyPropertiesLayer();
  if (map.getLayer(propertiesFillId))    map.removeLayer(propertiesFillId);
  if (map.getLayer(propertiesCircleId))  map.removeLayer(propertiesCircleId);
  if (map.getSource(propertiesSourceId)) map.removeSource(propertiesSourceId);
  if (map.getSource(recommendationsPointSrcId)) map.removeSource(recommendationsPointSrcId);
  if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }
  clearPropertyHighlight();
  clearSurveyPin();

  _currentRecommendationsGeojson = null;
  _activeChoroplethModeId        = DEFAULT_CHOROPLETH_MODE_ID;
  _activeView                    = null;
  _neighborhoodsGeojson          = null;
  _singlePropertyObj             = null;
  _surveyProperties              = null;
  _currentSurveyActiveIdx        = 0;
  _hoveredNeighborhoodId         = null;

  // Reset map pitch to flat view
  if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 400 });

  // Restore basemap 3D-building layer opacity (was hidden during recommendations view)
  if (map.getLayer("building3D")) {
    map.setPaintProperty("building3D", "fill-extrusion-opacity", 0.4);
  }

  const modeButtons = document.getElementById("choropleth-mode-buttons");
  if (modeButtons) modeButtons.style.display = "none";
}

//--------------------------------------------------------------------
// Helper: detect geometry type from first feature
//--------------------------------------------------------------------
function _isPolygon(geojsonObj) {
  const type = geojsonObj.features?.[0]?.geometry?.type || "";
  return type === "Polygon" || type === "MultiPolygon";
}

//--------------------------------------------------------------------
// Helper: compute GeoJSON bounding box
//--------------------------------------------------------------------
function getGeojsonBounds(geojsonObj) {
  if (!geojsonObj?.features?.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function extend(coords) {
    for (const c of coords) {
      if (Array.isArray(c[0])) { extend(c); continue; }
      if (c[0] < minX) minX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] > maxY) maxY = c[1];
    }
  }

  for (const f of geojsonObj.features) {
    if (f.geometry?.coordinates) extend(f.geometry.coordinates);
  }

  return minX === Infinity ? null : [[minX, minY], [maxX, maxY]];
}

//--------------------------------------------------------------------
// Helper: compute 3-quantile stops (min, median, max) from a column
//--------------------------------------------------------------------
function _getQuantiles(geojsonObj, col) {
  const vals = geojsonObj.features
    .map(f => Number(f.properties[col]))
    .filter(v => Number.isFinite(v));

  if (!vals.length) return null;
  vals.sort((a, b) => a - b);

  const median = (() => {
    const idx = 0.5 * (vals.length - 1);
    const lo  = Math.floor(idx);
    const hi  = Math.ceil(idx);
    return lo === hi ? vals[lo] : vals[lo] * (1 - (idx - lo)) + vals[hi] * (idx - lo);
  })();

  let min = vals[0];
  let max = vals[vals.length - 1];

  // Guard: interpolate requires strictly ascending input values.
  let med = median;
  if (med <= min) med = min + CHOROPLETH_EPSILON;
  if (max <= med) max = med + CHOROPLETH_EPSILON;

  return { min, median: med, max };
}

//--------------------------------------------------------------------
// Helper: compute 5-quantile stops (min, p25, median, p75, max)
//--------------------------------------------------------------------
function _getQuantiles5(geojsonObj, col) {
  const vals = geojsonObj.features
    .map(f => Number(f.properties[col]))
    .filter(v => Number.isFinite(v));

  if (!vals.length) return null;
  vals.sort((a, b) => a - b);

  const n = vals.length;
  const quantile = (p) => {
    const idx = p * (n - 1);
    const lo  = Math.floor(idx);
    const hi  = Math.ceil(idx);
    return lo === hi ? vals[lo] : vals[lo] * (1 - (idx - lo)) + vals[hi] * (idx - lo);
  };

  let min = vals[0];
  let p25 = quantile(0.25);
  let med = quantile(0.5);
  let p75 = quantile(0.75);
  let max = vals[n - 1];

  // Ensure strictly ascending
  if (p25 <= min) p25 = min + CHOROPLETH_EPSILON;
  if (med <= p25) med = p25 + CHOROPLETH_EPSILON;
  if (p75 <= med) p75 = med + CHOROPLETH_EPSILON;
  if (max <= p75) max = p75 + CHOROPLETH_EPSILON;

  return { min, p25, med, p75, max };
}

//--------------------------------------------------------------------
// Helper: build MapLibre color expression + value/color stop pairs.
// Returns { expr, stops } where stops = [[value, hexColor], ...].
// Both are derived from the mode's own color palette so histogram bars
// and map geometry always share the same coloring.
//--------------------------------------------------------------------
function _buildColorExpr(geojsonObj, mode) {
  const c = mode.colors;
  if (mode.stops === 5) {
    const q = _getQuantiles5(geojsonObj, mode.col);
    if (!q) return { expr: c[2], stops: [] };
    const stops = [[q.min, c[0]], [q.p25, c[1]], [q.med, c[2]], [q.p75, c[3]], [q.max, c[4]]];
    return {
      expr: ["interpolate", ["linear"], ["get", mode.col],
             q.min, c[0], q.p25, c[1], q.med, c[2], q.p75, c[3], q.max, c[4]],
      stops,
    };
  }
  const q = _getQuantiles(geojsonObj, mode.col);
  if (!q) return { expr: c[1], stops: [] };
  const stops = [[q.min, c[0]], [q.median, c[1]], [q.max, c[2]]];
  return {
    expr: ["interpolate", ["linear"], ["get", mode.col],
           q.min, c[0], q.median, c[1], q.max, c[2]],
    stops,
  };
}

//--------------------------------------------------------------------
// Mode buttons: init click listeners + update choropleth paint props
//--------------------------------------------------------------------
function _initModeButtons() {
  const container = document.getElementById("choropleth-mode-buttons");
  if (!container) return;

  container.style.display = "flex";

  // Reset all buttons, activate default
  container.querySelectorAll(".choropleth-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === _activeChoroplethModeId);
    // Replace old listener by cloning
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
  });

  container.querySelectorAll(".choropleth-btn").forEach(btn => {
    btn.addEventListener("click", () => updateChoroplethMode(btn.dataset.mode));
  });
}

function updateChoroplethMode(modeId) {
  const mode = CHOROPLETH_MODES.find(m => m.id === modeId);
  if (!mode || !_currentRecommendationsGeojson) return;

  _activeChoroplethModeId = modeId;

  const { expr: colorExpr, stops } = _buildColorExpr(_currentRecommendationsGeojson, mode);

  if (map.getLayer(propertiesFillId)) {
    map.setPaintProperty(propertiesFillId, "fill-extrusion-color", colorExpr);
  }
  if (map.getLayer(propertiesCircleId)) {
    map.setPaintProperty(propertiesCircleId, "circle-color",        colorExpr);
    map.setPaintProperty(propertiesCircleId, "circle-stroke-color", colorExpr);
  }

  // Update button active states
  document.querySelectorAll(".choropleth-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === modeId);
  });

  // Notify charts — pass value/color stops so histogram bars can match the map
  if (typeof window.onChoroplethModeChange === "function") {
    window.onChoroplethModeChange(modeId, mode.col, mode.label, stops);
  }
}

//--------------------------------------------------------------------
// Internal: clear old property layers/source, add fresh source + layer
//--------------------------------------------------------------------
function _applyLayer(geojsonObj, colorExpr, fitPadding, fitOptions = {}) {
  const applyFn = () => {
    // Clear property layers and sources (not neighborhood layers)
    if (map.getLayer(propertiesFillId))   map.removeLayer(propertiesFillId);
    if (map.getLayer(propertiesCircleId)) map.removeLayer(propertiesCircleId);
    if (map.getSource(propertiesSourceId))        map.removeSource(propertiesSourceId);
    if (map.getSource(recommendationsPointSrcId)) map.removeSource(recommendationsPointSrcId);

    map.addSource(propertiesSourceId, { type: "geojson", data: geojsonObj });

    if (_isPolygon(geojsonObj)) {
      // Dual-layer: circles when zoomed out, fill polygon when zoomed in
      map.addSource(recommendationsPointSrcId, {
        type: "geojson",
        data: _polygonsToPoints(geojsonObj),
      });

      // Fill layer — visible only at zoom >= RECOMMENDATIONS_POLYGON_MIN_ZOOM
      map.addLayer({
        id:      propertiesFillId,
        type:    "fill",
        source:  propertiesSourceId,
        minzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
        paint: {
          "fill-color":         colorExpr,
          "fill-opacity":       PROP_FILL_OPACITY,
          "fill-outline-color": _c().fillOutline,
        },
      });

      // Circle layer — visible only at zoom < RECOMMENDATIONS_POLYGON_MIN_ZOOM
      map.addLayer({
        id:      propertiesCircleId,
        type:    "circle",
        source:  recommendationsPointSrcId,
        maxzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
        paint: {
          "circle-radius":       PROP_CIRCLE_RADIUS,
          "circle-color":        colorExpr,
          "circle-stroke-color": _c().circleStroke,
          "circle-stroke-width": PROP_CIRCLE_STROKE_WIDTH,
          "circle-opacity":      PROP_CIRCLE_OPACITY,
        },
      });
    } else {
      map.addLayer({
        id:     propertiesCircleId,
        type:   "circle",
        source: propertiesSourceId,
        paint: {
          "circle-radius":       PROP_CIRCLE_RADIUS,
          "circle-color":        colorExpr,
          "circle-stroke-color": _c().circleStroke,
          "circle-stroke-width": PROP_CIRCLE_STROKE_WIDTH,
          "circle-opacity":      PROP_CIRCLE_OPACITY,
        },
      });
    }

    const bounds = getGeojsonBounds(geojsonObj);
    if (bounds) map.fitBounds(bounds, { padding: fitPadding, ...fitOptions });
  };

  if (!map.isStyleLoaded()) {
    map.once("load", applyFn);
  } else {
    applyFn();
  }
}

//--------------------------------------------------------------------
// showNeighborhoodsOnMap  – display all neighborhoods for selection
//--------------------------------------------------------------------
function showNeighborhoodsOnMap(geojson) {
  _neighborhoodsGeojson = geojson;
  _activeView           = "neighborhoods";

  const applyFn = () => {
    clearNeighborhoodLayer();

    // generateId: true enables feature-state (hover highlight)
    map.addSource(neighborhoodSourceId, { type: "geojson", data: geojson, generateId: true });

    // Fill — opacity driven by feature-state hover
    map.addLayer({
      id:     neighborhoodFillId,
      type:   "fill",
      source: neighborhoodSourceId,
      paint: {
        "fill-color":   _c().neighborhood,
        "fill-opacity": ["case",
          ["boolean", ["feature-state", "hover"], false],
          NEIGHBORHOOD_SELECTED_FILL_OPACITY,
          NEIGHBORHOOD_FILL_OPACITY,
        ],
      },
    });

    // Visible boundary outlines
    map.addLayer({
      id:     neighborhoodOutlineId,
      type:   "line",
      source: neighborhoodSourceId,
      paint: {
        "line-color":   _c().neighborhood,
        "line-width":   NEIGHBORHOOD_LINE_WIDTH,
        "line-opacity": NEIGHBORHOOD_LINE_OPACITY,
      },
    });

    // Hover: show selected-opacity fill via feature-state
    map.on("mousemove", neighborhoodFillId, (e) => {
      if (!e.features.length) return;
      map.getCanvas().style.cursor = "pointer";
      const feat = e.features[0];
      if (_hoveredNeighborhoodId !== null && _hoveredNeighborhoodId !== feat.id) {
        map.setFeatureState({ source: neighborhoodSourceId, id: _hoveredNeighborhoodId }, { hover: false });
      }
      _hoveredNeighborhoodId = feat.id;
      map.setFeatureState({ source: neighborhoodSourceId, id: _hoveredNeighborhoodId }, { hover: true });
    });

    map.on("mouseleave", neighborhoodFillId, () => {
      if (_hoveredNeighborhoodId !== null) {
        map.setFeatureState({ source: neighborhoodSourceId, id: _hoveredNeighborhoodId }, { hover: false });
        _hoveredNeighborhoodId = null;
      }
      map.getCanvas().style.cursor = "";
    });

    // Click: highlight selected neighborhood and notify neighborhood.js
    map.on("click", neighborhoodFillId, (e) => {
      const feature = e.features[0];
      if (!feature) return;

      const name = feature.properties.small_n
        || feature.properties.name
        || feature.properties.ntaname
        || "Unknown";

      const lon      = feature.properties.centroid_lon;
      const lat      = feature.properties.centroid_lat;
      const borocode = feature.properties.borocode;

      // Replace previous selection highlight
      if (map.getLayer(neighborhoodSelectedFillId)) map.removeLayer(neighborhoodSelectedFillId);
      if (map.getSource(neighborhoodSelectedSrcId))  map.removeSource(neighborhoodSelectedSrcId);

      map.addSource(neighborhoodSelectedSrcId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [feature] },
      });
      map.addLayer({
        id:     neighborhoodSelectedFillId,
        type:   "fill",
        source: neighborhoodSelectedSrcId,
        paint: {
          "fill-color":   _c().neighborhood,
          "fill-opacity": NEIGHBORHOOD_SELECTED_FILL_OPACITY,
        },
      });

      if (typeof window.onNeighborhoodClick === "function") {
        window.onNeighborhoodClick(name, lon, lat, borocode);
      }
    });

    const bounds = getGeojsonBounds(geojson);
    if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING_NEIGHBORHOODS });
  };

  if (!map.isStyleLoaded()) {
    map.once("load", applyFn);
  } else {
    applyFn();
  }
}

//--------------------------------------------------------------------
// showAllSurveyPropertiesOnMap  – display all 10 survey properties at once.
// Below zoom 11 → circles; at/above zoom 11 → polygon fills.
//--------------------------------------------------------------------
function showAllSurveyPropertiesOnMap(properties) {
  _surveyProperties = properties;
  _activeView       = "single";

  const geojson = {
    type:     "FeatureCollection",
    features: properties
      .filter(p => p.geom)
      .map(p => ({
        type:     "Feature",
        geometry: p.geom,
        properties: {
          centroid_lon: p.centroid_lon,
          centroid_lat: p.centroid_lat,
          rent_knn:     p.rent_knn,
          small_n:      p.small_n,
          bld_story:    p.bld_story,
        },
      })),
  };

  const applyFn = () => {
    clearSurveyPropertiesLayer();
    const color = _c().singleProp;

    map.addSource(surveyPropertiesSrcId,   { type: "geojson", data: geojson });
    map.addSource(surveyPropertiesPtSrcId, { type: "geojson", data: _polygonsToPoints(geojson) });

    // Fill-extrusion — visible at zoom >= 11 (identical to recommendations final view)
    map.addLayer({
      id:      surveyPropertiesFillId,
      type:    "fill-extrusion",
      source:  surveyPropertiesSrcId,
      minzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
      paint: {
        "fill-extrusion-color":   color,
        "fill-extrusion-opacity": PROP_FILL_OPACITY,
        "fill-extrusion-base":    ["*",
          ["max", ["-", ["to-number", ["get", "bld_story"]], 1], 0],
          3.048],
        "fill-extrusion-height":  ["*",
          ["max", ["to-number", ["get", "bld_story"]], 1],
          3.048],
      },
    });

    // Circle — visible at zoom < 11
    map.addLayer({
      id:      surveyPropertiesCircleId,
      type:    "circle",
      source:  surveyPropertiesPtSrcId,
      maxzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
      paint: {
        "circle-radius":       PROP_CIRCLE_RADIUS,
        "circle-color":        color,
        "circle-stroke-color": _c().circleStroke,
        "circle-stroke-width": PROP_CIRCLE_STROKE_WIDTH,
        "circle-opacity":      PROP_CIRCLE_OPACITY,
      },
    });
  };

  if (!map.isStyleLoaded()) {
    map.once("load", applyFn);
  } else {
    applyFn();
  }
}

//--------------------------------------------------------------------
// clearSurveyPropertiesLayer  – remove the survey property layers/sources
//--------------------------------------------------------------------
function clearSurveyPropertiesLayer() {
  if (map.getLayer(surveyPropertiesFillId))   map.removeLayer(surveyPropertiesFillId);
  if (map.getLayer(surveyPropertiesCircleId)) map.removeLayer(surveyPropertiesCircleId);
  if (map.getSource(surveyPropertiesSrcId))   map.removeSource(surveyPropertiesSrcId);
  if (map.getSource(surveyPropertiesPtSrcId)) map.removeSource(surveyPropertiesPtSrcId);
}

//--------------------------------------------------------------------
// showSinglePropertyOnMap  – fly to a survey property's centroid.
// All 10 geometries are already displayed by showAllSurveyPropertiesOnMap.
//--------------------------------------------------------------------
function showSinglePropertyOnMap(property) {
  _singlePropertyObj = property;
  const lon = Number(property.centroid_lon);
  const lat = Number(property.centroid_lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  map.flyTo({
    center:   [lon, lat],
    zoom:     Math.max(map.getZoom(), 12),
    duration: Math.round(600 / SINGLE_PROP_FIT_SPEED),
  });
}

//--------------------------------------------------------------------
// clearSurveyPin  – removes all survey-step pin markers
//--------------------------------------------------------------------
function clearSurveyPin() {
  if (_surveyPropMarker) { _surveyPropMarker.remove(); _surveyPropMarker = null; }
  _allSurveyPinMarkers.forEach(m => m && m.remove());
  _allSurveyPinMarkers = [];
}

//--------------------------------------------------------------------
// showSurveyPinsOnMap  – place pins for all survey properties at once.
// The active pin is full opacity; others are dimmed.
//--------------------------------------------------------------------
function showSurveyPinsOnMap(properties, activeIdx) {
  clearSurveyPin();

  properties.forEach((prop, idx) => {
    const lon = Number(prop.centroid_lon);
    const lat = Number(prop.centroid_lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      _allSurveyPinMarkers.push(null); // keep index alignment
      return;
    }

    const el = document.createElement("div");
    el.className   = "property-pin";
    el.style.opacity    = (idx === activeIdx) ? "1" : "0.3";
    el.style.transition = "opacity 0.2s";
    el.innerHTML = `<svg width="20" height="40" viewBox="0 0 20 40" xmlns="http://www.w3.org/2000/svg">
      <line x1="10" y1="18" x2="10" y2="40" stroke="${_c().pinLine}" stroke-width="2"/>
      <circle cx="10" cy="10" r="9" fill="${_c().pinCircle}" stroke="${_c().pinLine}" stroke-width="1.5"/>
    </svg>`;

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([lon, lat])
      .addTo(map);
    _allSurveyPinMarkers.push(marker);
  });
}

//--------------------------------------------------------------------
// updateActiveSurveyPin  – change which survey pin is fully opaque
//--------------------------------------------------------------------
function updateActiveSurveyPin(activeIdx) {
  _currentSurveyActiveIdx = activeIdx;
  _allSurveyPinMarkers.forEach((marker, idx) => {
    if (!marker) return;
    marker.getElement().style.opacity = (idx === activeIdx) ? "1" : "0.3";
  });
}

//--------------------------------------------------------------------
// Hover tooltip helpers for recommendation properties
//--------------------------------------------------------------------
function _buildTooltipHTML(props) {
  const rows = TOOLTIP_FIELDS.map(({ key, label }) => {
    const raw = props[key];
    let display = "—";
    if (raw != null && raw !== "" && raw !== 0) {
      if (key === "rent_knn") {
        display = `$${Math.round(raw).toLocaleString()}/mo`;
      } else if (key === "sqft") {
        display = `${Math.round(raw).toLocaleString()} sqft`;
      } else {
        display = raw;
      }
    }
    return `<tr><td class="tt-label">${label}</td><td class="tt-value">${display}</td></tr>`;
  }).join("");
  return `<table class="prop-tooltip">${rows}</table>`;
}

function _attachClickHighlight(layerId) {
  map.on("click", layerId, (e) => {
    if (!e.features.length) return;
    if (typeof window.onPropertyClick === "function") {
      window.onPropertyClick(e.features[0].properties);
    }
  });
}

function _attachHoverTooltip(layerId) {
  map.on("mousemove", layerId, (e) => {
    if (!e.features.length) return;
    map.getCanvas().style.cursor = "pointer";

    if (!_hoverPopup) {
      _hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth:     "220px",
        offset:       12,
      });
    }
    _hoverPopup
      .setLngLat(e.lngLat)
      .setHTML(_buildTooltipHTML(e.features[0].properties))
      .addTo(map);
  });

  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
    if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }
  });
}

//--------------------------------------------------------------------
// Helper: build a Point GeoJSON from centroid_lon/lat properties
// Used so MapLibre can render circles on polygon-geometry data
//--------------------------------------------------------------------
function _polygonsToPoints(geojsonObj) {
  return {
    type: "FeatureCollection",
    features: geojsonObj.features
      .filter(f => f.properties.centroid_lon != null && f.properties.centroid_lat != null)
      .map(f => ({
        ...f,
        geometry: {
          type:        "Point",
          coordinates: [f.properties.centroid_lon, f.properties.centroid_lat],
        },
      })),
  };
}

//--------------------------------------------------------------------
// Internal: add dual layers for recommendations
//   zoom <  RECOMMENDATIONS_POLYGON_MIN_ZOOM → circles (point source)
//   zoom >= RECOMMENDATIONS_POLYGON_MIN_ZOOM → polygon fills
// Border color matches the choropleth fill color on both layer types.
//--------------------------------------------------------------------
function _applyRecommendationLayers(geojsonObj, colorExpr, fitPadding) {
  const applyFn = () => {
    // Remove stale popup before rebuilding layers
    if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }

    if (map.getLayer(propertiesFillId))   map.removeLayer(propertiesFillId);
    if (map.getLayer(propertiesCircleId)) map.removeLayer(propertiesCircleId);
    if (map.getSource(propertiesSourceId))        map.removeSource(propertiesSourceId);
    if (map.getSource(recommendationsPointSrcId)) map.removeSource(recommendationsPointSrcId);

    // Polygon source (for fill layer at high zoom)
    map.addSource(propertiesSourceId, { type: "geojson", data: geojsonObj });

    // Point source derived from centroid properties (for circle layer at low zoom)
    map.addSource(recommendationsPointSrcId, {
      type: "geojson",
      data: _polygonsToPoints(geojsonObj),
    });

    // Fill-extrusion layer — visible only when zoomed IN (>= zoom 11)
    // Each property extruded 10 ft per floor (bld_story = floor number):
    //   base   = (floor - 1) × 3.048 m   (3.048 m ≈ 10 ft)
    //   height = floor × 3.048 m
    map.addLayer({
      id:      propertiesFillId,
      type:    "fill-extrusion",
      source:  propertiesSourceId,
      minzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
      paint: {
        "fill-extrusion-color":   colorExpr,
        "fill-extrusion-opacity": PROP_FILL_OPACITY,
        "fill-extrusion-base":    ["*",
          ["max", ["-", ["to-number", ["get", "bld_story"]], 1], 0],
          3.048],
        "fill-extrusion-height":  ["*",
          ["max", ["to-number", ["get", "bld_story"]], 1],
          3.048],
      },
    });

    // Circle layer — visible only when zoomed OUT
    // circle-sort-key: higher final_score drawn on top (painted last)
    map.addLayer({
      id:      propertiesCircleId,
      type:    "circle",
      source:  recommendationsPointSrcId,
      maxzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
      layout: {
        "circle-sort-key": ["get", SCORE_PROPERTY],
      },
      paint: {
        "circle-radius":       PROP_CIRCLE_RADIUS,
        "circle-color":        colorExpr,
        "circle-stroke-color": colorExpr,  // border matches fill
        "circle-stroke-width": PROP_CIRCLE_STROKE_WIDTH,
        "circle-opacity":      PROP_CIRCLE_OPACITY,
      },
    });

    // Attach hover tooltips and click highlight to both layers
    _attachHoverTooltip(propertiesFillId);
    _attachHoverTooltip(propertiesCircleId);
    _attachClickHighlight(propertiesFillId);
    _attachClickHighlight(propertiesCircleId);

    // Register the single empty-space click handler (once)
    _attachMapEmptyClickHandler();

    // Hide the basemap 3D-building layer so it doesn't occlude our fill-extrusion
    // properties (basemap buildings render with depth testing that can cover our layer).
    if (map.getLayer("building3D")) {
      map.setPaintProperty("building3D", "fill-extrusion-opacity", 0);
    }

    const bounds = getGeojsonBounds(geojsonObj);
    if (bounds) map.fitBounds(bounds, { padding: fitPadding });
  };

  if (!map.isStyleLoaded()) {
    map.once("load", applyFn);
  } else {
    applyFn();
  }
}

//--------------------------------------------------------------------
// showRecommendationsOnMap  – top results, default choropleth by score
//--------------------------------------------------------------------
function showRecommendationsOnMap(geojson) {
  _currentRecommendationsGeojson = geojson;
  _activeChoroplethModeId        = DEFAULT_CHOROPLETH_MODE_ID;
  _activeView                    = "recommendations";

  const defMode = CHOROPLETH_MODES.find(m => m.id === DEFAULT_CHOROPLETH_MODE_ID);
  const { expr: colorExpr } = _buildColorExpr(geojson, defMode);

  _applyRecommendationLayers(geojson, colorExpr, FIT_PADDING_RECOMMENDATIONS);
  _initModeButtons();
}

//--------------------------------------------------------------------
// highlightPropertyOnMap / clearPropertyHighlight
// Places an SVG pin marker at the selected property's centroid.
// The original choropleth color is preserved — only the pin is added.
//--------------------------------------------------------------------
function clearPropertyHighlight() {
  if (_selectedPropMarker) { _selectedPropMarker.remove(); _selectedPropMarker = null; }
}

function highlightPropertyOnMap(feature) {
  clearPropertyHighlight();
  if (!feature) return;

  const lon = Number(feature.properties.centroid_lon);
  const lat = Number(feature.properties.centroid_lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

  // Simple pin: red circle on top, white vertical line pointing down to the property
  const el = document.createElement("div");
  el.style.cssText = "pointer-events:none;";
  el.innerHTML = `<svg width="20" height="40" viewBox="0 0 20 40" xmlns="http://www.w3.org/2000/svg">
    <line x1="10" y1="18" x2="10" y2="40" stroke="${_c().pinLine}" stroke-width="2"/>
    <circle cx="10" cy="10" r="9" fill="${_c().pinCircle}" stroke="${_c().pinLine}" stroke-width="1.5"/>
  </svg>`;

  _selectedPropMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([lon, lat])
    .addTo(map);
}

//--------------------------------------------------------------------
// filterMapByBin / clearMapBinFilter
// Restricts visible recommendation features to a specific bin range.
//--------------------------------------------------------------------
function filterMapByBin(col, binMin, binMax) {
  if (!_currentRecommendationsGeojson) return;

  const filtered = {
    type: "FeatureCollection",
    features: _currentRecommendationsGeojson.features.filter(f => {
      const v = Number(f.properties[col]);
      return Number.isFinite(v) && v >= binMin && v < binMax;
    }),
  };

  const polygonSrc = map.getSource(propertiesSourceId);
  if (polygonSrc) polygonSrc.setData(filtered);
  const pointSrc = map.getSource(recommendationsPointSrcId);
  if (pointSrc) pointSrc.setData(_polygonsToPoints(filtered));

  const bounds = getGeojsonBounds(filtered);
  if (bounds) map.fitBounds(bounds, { padding: 60 });
}

function clearMapBinFilter() {
  if (!_currentRecommendationsGeojson) return;
  const polygonSrc = map.getSource(propertiesSourceId);
  if (polygonSrc) polygonSrc.setData(_currentRecommendationsGeojson);
  const pointSrc = map.getSource(recommendationsPointSrcId);
  if (pointSrc) pointSrc.setData(_polygonsToPoints(_currentRecommendationsGeojson));
}

//--------------------------------------------------------------------
// _attachMapEmptyClickHandler
// Single general click handler: clears bin filter + highlight when the
// user clicks empty map space (no recommendation feature under cursor).
//--------------------------------------------------------------------
function _attachMapEmptyClickHandler() {
  if (_mapEmptyClickAttached) return;
  _mapEmptyClickAttached = true;
  map.on("click", (e) => {
    if (!_currentRecommendationsGeojson) return;
    const activeLayers = [propertiesFillId, propertiesCircleId].filter(id => map.getLayer(id));
    const hits = map.queryRenderedFeatures(e.point, { layers: activeLayers });
    if (!hits.length) {
      clearMapBinFilter();
      clearPropertyHighlight();
    }
  });
}

//--------------------------------------------------------------------
// flyToProperty  – fly the map to a property's centroid (for listing clicks)
//--------------------------------------------------------------------
function flyToProperty(props) {
  const lon = Number(props.centroid_lon);
  const lat = Number(props.centroid_lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
}

//--------------------------------------------------------------------
// Expose to other scripts
//--------------------------------------------------------------------
//--------------------------------------------------------------------
// Map view control buttons: 2D/3D pitch toggle + North (bearing reset)
// Shown at all times in the top-right corner of the map.
//--------------------------------------------------------------------
(function _initMapViewButtons() {
  const pitchBtn = document.getElementById("btn-pitch-toggle");
  const northBtn = document.getElementById("btn-north-reset");
  if (!pitchBtn || !northBtn) return;

  function _syncPitchBtn() {
    pitchBtn.textContent = (map.getPitch() > 5) ? "2D" : "3D";
  }

  pitchBtn.addEventListener("click", () => {
    if (map.getPitch() > 5) {
      map.easeTo({ pitch: 0, duration: 600 });
    } else {
      map.easeTo({ pitch: 45, duration: 600 });
    }
  });

  northBtn.addEventListener("click", () => {
    map.easeTo({ bearing: 0, duration: 500 });
  });

  // Keep button label in sync with current pitch
  map.on("pitch", _syncPitchBtn);
  map.on("load",  _syncPitchBtn);
  _syncPitchBtn();
})();


//--------------------------------------------------------------------
// _reapplyCurrentState
// Re-adds sources and layers after a basemap style switch.
//--------------------------------------------------------------------
function _reapplyCurrentState() {
  if (_activeView === "neighborhoods" && _neighborhoodsGeojson) {
    showNeighborhoodsOnMap(_neighborhoodsGeojson);
  } else if (_activeView === "single" && _surveyProperties) {
    showAllSurveyPropertiesOnMap(_surveyProperties);
    showSurveyPinsOnMap(_surveyProperties, _currentSurveyActiveIdx);
  } else if (_activeView === "recommendations" && _currentRecommendationsGeojson) {
    const mode = CHOROPLETH_MODES.find(m => m.id === _activeChoroplethModeId);
    const { expr: colorExpr } = _buildColorExpr(_currentRecommendationsGeojson, mode);
    _applyRecommendationLayers(_currentRecommendationsGeojson, colorExpr, FIT_PADDING_RECOMMENDATIONS);
    _initModeButtons();
  }
}

//--------------------------------------------------------------------
// toggleMapStyle  – switch basemap between dark and bright styles,
// then re-apply all current data layers WITHOUT resetting the camera.
//--------------------------------------------------------------------
window.toggleMapStyle = function () {
  // Remove markers before style switch — recreated with correct colors in _reapplyCurrentState
  clearPropertyHighlight();
  clearSurveyPin();

  // Save camera so _reapplyCurrentState's fitBounds/flyTo calls don't reset the view
  const savedCenter  = map.getCenter();
  const savedZoom    = map.getZoom();
  const savedPitch   = map.getPitch();
  const savedBearing = map.getBearing();

  _currentStyleUrl = (_currentStyleUrl === STYLE_DARK) ? STYLE_BRIGHT : STYLE_DARK;
  map.setStyle(_currentStyleUrl);
  map.once("idle", () => {
    if (_activeView) _reapplyCurrentState();
    // Restore camera immediately — jumpTo cancels any fitBounds animation
    map.jumpTo({ center: savedCenter, zoom: savedZoom, pitch: savedPitch, bearing: savedBearing });
  });
};

//--------------------------------------------------------------------
// Expose to other scripts
//--------------------------------------------------------------------
window.showNeighborhoodsOnMap   = showNeighborhoodsOnMap;
window.clearNeighborhoodLayer   = clearNeighborhoodLayer;
window.showSinglePropertyOnMap       = showSinglePropertyOnMap;
window.showAllSurveyPropertiesOnMap  = showAllSurveyPropertiesOnMap;
window.showRecommendationsOnMap = showRecommendationsOnMap;
window.clearAllSources          = clearAllSources;
window.updateChoroplethMode     = updateChoroplethMode;
window.clearSurveyPin           = clearSurveyPin;
window.showSurveyPinsOnMap      = showSurveyPinsOnMap;
window.updateActiveSurveyPin    = updateActiveSurveyPin;

window.flyToProperty          = flyToProperty;
window.highlightPropertyOnMap = highlightPropertyOnMap;
window.filterMapByBin         = filterMapByBin;
window.clearMapBinFilter      = clearMapBinFilter;

window.getColorStopsForMode = function (geojsonObj, modeId) {
  const mode = CHOROPLETH_MODES.find(m => m.id === modeId);
  if (!mode || !geojsonObj) return [];
  return _buildColorExpr(geojsonObj, mode).stops;
};
