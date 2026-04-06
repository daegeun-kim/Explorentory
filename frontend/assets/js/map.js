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

// Dark mode — neon/bright ramps that read on a dark basemap
const CHOROPLETH_MODES_DARK = [
  {
    id: "score",   label: "Score",             col: "final_score",        stops: 5,
    colors: ["#ff5571", "#ff9886", "#fffef2", "#7eff43", "#18f197"],
  },
  {
    id: "rent",    label: "Rent",              col: "rent_knn",           stops: 5,
    colors: ["#003ab8", "#0044ff", "#167bff", "#33cfff", "#ffffff"],
  },
  {
    id: "sqft",    label: "Sqft",              col: "sqft",               stops: 5,
    colors: ["#00575a", "#0098b3", "#00c1cf", "#0dffd7", "#ffffff"],
  },
  {
    id: "built",   label: "Built Year",        col: "built_year",         stops: 5,
    colors: ["#6e2300", "#b93500", "#ff5917", "#ff985d", "#ffffff"],
  },
  {
    id: "stories", label: "Stories",           col: "bld_story",          stops: 5,
    colors: ["#630070", "#9300a7", "#f713ff", "#ff75ff", "#ffffff"],
  },
  {
    id: "elevator",label: "Elevator",          col: "elevator",           fixedStops: [0, 1],
    colors: ["#b7d5e6", "#98ee48"],
  },
  {
    id: "park",       label: "Major Park Distance", col: "dist_major_park_ft", stops: 5,
    colors: ["#18f18c", "#0dbe42", "#a8c051", "#d8ae61", "#dd6a6a"],
  },
  {
    id: "greenspace", label: "Green Space Distance", col: "dist_greenspace_ft", stops: 5,
    colors: ["#18f18c", "#0dbe42", "#a8c051", "#d8ae61", "#dd6a6a"],
  },
  {
    id: "subway",     label: "Subway Distance",    col: "dist_subway_ft",     stops: 5,
    colors: ["#002477", "#0052aa", "#0090dd", "#33cfff", "#ffffff"],
  },
  {
    id: "noise",      label: "Noise Level",     col: "noise_level_ord",
    fixedStops: [0, 1, 2, 3, 4],
    colors: ["#00d4ff", "#6ecc00", "#ffe000", "#ff7700", "#ff1111"],
  },
];

// Bright mode — dark, saturated ramps that read on a light basemap
// Avoids near-white endpoints; all stops visible on a white/light-grey background
const CHOROPLETH_MODES_BRIGHT = [
  {
    id: "score",   label: "Score",             col: "final_score",        stops: 5,
    colors: ["#9e0020", "#c44000", "#646464", "#3da700", "#005c36"],
  },
  {
    id: "rent",    label: "Rent",              col: "rent_knn",           stops: 5,
    colors: ["#9fd4ff", "#499eff", "#0050c8", "#002c93", "#000850"],
  },
  {
    id: "sqft",    label: "Sqft",              col: "sqft",               stops: 5,
    colors: ["#a0ffff", "#3dfff2", "#00d3d7", "#008686", "#005a5a"],
  },
  {
    id: "built",   label: "Built Year",        col: "built_year",         stops: 5,
    colors: ["#ffc3ad", "#ff915e", "#ef5d0f", "#923f00", "#4d2100"],
  },
  {
    id: "stories", label: "Stories",           col: "bld_story",          stops: 5,
    colors: ["#f6aeff", "#ea72ff", "#c50dde", "#8c028c", "#3e003e"],
  },
  {
    id: "elevator",   label: "Elevator",       col: "elevator",           fixedStops: [0, 1],
    colors: ["#426174", "#5dad12"],
  },
  {
    id: "park",       label: "Major Park Distance", col: "dist_major_park_ft", stops: 5,
    colors: ["#005c30", "#3a7800", "#859b37", "#835e1a", "#961515"],
  },
  {
    id: "greenspace", label: "Green Space Distance", col: "dist_greenspace_ft", stops: 5,
    colors: ["#005c30", "#3a7800", "#859b37", "#835e1a", "#961515"],
  },
  {
    id: "subway",     label: "Subway Distance",    col: "dist_subway_ft",     stops: 5,
    colors: ["#ccecfc", "#6bbcf7", "#1988ce", "#006caf", "#003874"],
  },
  {
    id: "noise",      label: "Noise Level",     col: "noise_level_ord",
    fixedStops: [0, 1, 2, 3, 4],
    colors: ["#004455", "#336600", "#665500", "#883300", "#660000"],
  },
];

// Kept for backward compatibility — always points to the correct set at call time
const CHOROPLETH_MODES = CHOROPLETH_MODES_DARK;
const DEFAULT_CHOROPLETH_MODE_ID = "score";

// Returns the correct palette set for the current basemap style
function _getChoroplethModes() {
  return (typeof _currentStyleUrl !== "undefined" && _currentStyleUrl === STYLE_BRIGHT)
    ? CHOROPLETH_MODES_BRIGHT
    : CHOROPLETH_MODES_DARK;
}

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
const PROP_CIRCLE_STROKE_WIDTH = 0.5;
const PROP_CIRCLE_OPACITY      = 0.5;

// Survey-step property colors (fixed regardless of dark/bright mode)
const SURVEY_COLOR_DEFAULT  = "#1a6bc0";  // unselected
const SURVEY_COLOR_SELECTED = "#63adf2";  // active / highlighted

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
  neighborhood: "#0f55a0",
  singleProp:   "#0f55a0",
  fillOutline:  "#818181",
  circleStroke: "#818181",
  pinLine:      "#818181",
  pinCircle:    "#a70b0b",
};
// Evaluated at call time so it always reflects the current style
function _c() {
  return (typeof _currentStyleUrl !== "undefined" && _currentStyleUrl === STYLE_BRIGHT)
    ? _BRIGHT_COLORS
    : _DARK_COLORS;
}

// Zoom thresholds for property geometry display:
//   zoom < PROP_CIRCLE_MAX_ZOOM                           → circle marker
//   PROP_CIRCLE_MAX_ZOOM ≤ zoom < PROP_EXTRUSION_MIN_ZOOM → flat polygon fill
//   zoom ≥ PROP_EXTRUSION_MIN_ZOOM                        → 3-D fill-extrusion
const PROP_CIRCLE_MAX_ZOOM    = 12;
const PROP_EXTRUSION_MIN_ZOOM = 14;

// Fields shown in the hover tooltip for recommendation properties
// (in display order; keys must match GeoJSON property names from nyc_units)
const TOOLTIP_FIELDS = [
  { key: "rent_knn",      label: "Rent" },
  { key: "sqft",          label: "Sqft" },
  { key: "livingroomnum", label: "Living Rooms" },
  { key: "bedroomnum",    label: "Bedrooms" },
  { key: "bathroomnum",   label: "Bathrooms" },
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

// Click-pinned popup that stays open and hosts the Explain button / LLM response
let _explainClickPopup = null;

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
let _surveyHighlightIdx     = null;   // which property is currently highlighted on map

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
const surveyPropertiesSrcId = "survey-properties";
const surveyPropertiesPtSrcId = "survey-properties-points";
const surveyCircleId  = "survey-properties-circle";
const surveyFillId    = "survey-properties-fill";
const surveyExtId     = "survey-properties-extrusion";

//--------------------------------------------------------------------
// Source / layer ids — recommendations / final view
//--------------------------------------------------------------------
const propertiesSourceId        = "properties";
const recommendationsPointSrcId = "recommendations-points";
const propCircleId = "properties-circle";
const propFillId   = "properties-fill";
const propExtId    = "properties-extrusion";

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
  [propExtId, propFillId, propCircleId].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource(propertiesSourceId))        map.removeSource(propertiesSourceId);
  if (map.getSource(recommendationsPointSrcId)) map.removeSource(recommendationsPointSrcId);
  if (_hoverPopup)        { _hoverPopup.remove();        _hoverPopup        = null; }
  if (_explainClickPopup) { _explainClickPopup.remove(); _explainClickPopup = null; }
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

  if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 400 });

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
// Helper: compute centroid [lon, lat] from a GeoJSON geometry object.
// Used as fallback when centroid_lon/lat are absent from the raw data.
//--------------------------------------------------------------------
function _centroidFromGeom(geom) {
  if (!geom) return null;
  if (geom.type === "Point") return [geom.coordinates[0], geom.coordinates[1]];
  let ring = null;
  if      (geom.type === "Polygon")      ring = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0][0];
  if (!ring || !ring.length) return null;
  const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  return [lon, lat];
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

  // Fixed stops — skip quantile computation, use literal value array.
  // ["to-number"] ensures booleans (true/false from GeoJSON) are treated as numbers.
  if (mode.fixedStops) {
    const fv       = mode.fixedStops;
    const pairs    = fv.map((v, i) => [v, c[i]]);
    const numInput = ["to-number", ["get", mode.col], 0];
    if (fv.length === 2) {
      // step: input < fv[1] → c[0], input >= fv[1] → c[1]
      return {
        expr:  ["step", numInput, c[0], fv[1], c[1]],
        stops: pairs,
      };
    }
    // Multi-value interpolate (e.g. noise ordinal 0–4)
    const interpArgs = ["interpolate", ["linear"], numInput];
    fv.forEach((v, i) => interpArgs.push(v, c[i]));
    return { expr: interpArgs, stops: pairs };
  }

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
// Mode dropdown: build a <select> with all choropleth modes
//--------------------------------------------------------------------
function _initModeDropdown() {
  const container = document.getElementById("choropleth-mode-buttons");
  if (!container) return;

  container.style.display = "block";
  container.innerHTML = "";

  const select = document.createElement("select");
  select.id = "choropleth-mode-select";

  _getChoroplethModes().forEach(mode => {
    const opt = document.createElement("option");
    opt.value       = mode.id;
    opt.textContent = mode.label;
    opt.selected    = (mode.id === _activeChoroplethModeId);
    select.appendChild(opt);
  });

  select.addEventListener("change", () => updateChoroplethMode(select.value));
  container.appendChild(select);
}

function updateChoroplethMode(modeId) {
  const mode = _getChoroplethModes().find(m => m.id === modeId);
  if (!mode || !_currentRecommendationsGeojson) return;

  _activeChoroplethModeId = modeId;

  const { expr: colorExpr, stops } = _buildColorExpr(_currentRecommendationsGeojson, mode);

  if (map.getLayer(propExtId)) {
    map.setPaintProperty(propExtId, "fill-extrusion-color", colorExpr);
  }
  if (map.getLayer(propFillId)) {
    map.setPaintProperty(propFillId, "fill-color", colorExpr);
  }
  if (map.getLayer(propCircleId)) {
    map.setPaintProperty(propCircleId, "circle-color", colorExpr);
  }

  // Sync dropdown selection
  const sel = document.getElementById("choropleth-mode-select");
  if (sel) sel.value = modeId;

  // Notify charts — pass value/color stops so histogram bars can match the map
  if (typeof window.onChoroplethModeChange === "function") {
    window.onChoroplethModeChange(modeId, mode.col, mode.label, stops);
  }
}

//--------------------------------------------------------------------
// _addPropertyTripleLayers
// Adds three layers for a property dataset covering all zoom levels:
//   circle  — zoom < PROP_CIRCLE_MAX_ZOOM       (low-detail point marker)
//   fill    — PROP_CIRCLE_MAX_ZOOM .. PROP_EXTRUSION_MIN_ZOOM (flat polygon)
//   extrusion — zoom ≥ PROP_EXTRUSION_MIN_ZOOM  (3-D fill-extrusion)
// Only fill + extrusion are added when the geometry is polygonal.
// opts.useSortKey: add circle-sort-key (score) for recommendations.
//--------------------------------------------------------------------
function _addPropertyTripleLayers(opts) {
  const { polySourceId, ptSourceId, circleId, fillId, extId, colorExpr, useSortKey, geojson, beforeExtId } = opts;
  const isPolygon = _isPolygon(geojson);

  // Circle — always added (point source, low zoom)
  const circleLayer = {
    id: circleId, type: "circle", source: ptSourceId,
    maxzoom: PROP_CIRCLE_MAX_ZOOM,
    paint: {
      "circle-radius":  PROP_CIRCLE_RADIUS,
      "circle-color":   colorExpr,
      "circle-opacity": PROP_CIRCLE_OPACITY,
    },
  };
  if (useSortKey) circleLayer.layout = { "circle-sort-key": ["get", SCORE_PROPERTY] };
  map.addLayer(circleLayer);

  if (!isPolygon) return;  // point-only data: nothing more to add

  // Flat fill — mid zoom (shows polygon footprint without extrusion)
  map.addLayer({
    id: fillId, type: "fill", source: polySourceId,
    minzoom: PROP_CIRCLE_MAX_ZOOM,
    maxzoom: PROP_EXTRUSION_MIN_ZOOM,
    paint: {
      "fill-color":   colorExpr,
      "fill-opacity": PROP_FILL_OPACITY,
    },
  });

  // Fill-extrusion — high zoom (3-D; one floor ≈ 3.048 m / 10 ft)
  // If beforeExtId names an existing layer, insert before it so our extrusion
  // renders first and wins the depth test (LESS) against that layer.
  const safeBeforeExt = beforeExtId && map.getLayer(beforeExtId) ? beforeExtId : undefined;
  map.addLayer({
    id: extId, type: "fill-extrusion", source: polySourceId,
    minzoom: PROP_EXTRUSION_MIN_ZOOM,
    paint: {
      "fill-extrusion-color":   colorExpr,
      "fill-extrusion-opacity": PROP_FILL_OPACITY,
      "fill-extrusion-base":   ["*", ["max", ["-", ["to-number", ["get", "bld_story"]], 1], 0], 3.048],
      "fill-extrusion-height": ["*", ["max", ["to-number", ["get", "bld_story"]], 1], 3.048],
    },
  }, safeBeforeExt);
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
// showAllSurveyPropertiesOnMap  – display all 10 survey properties.
// zoom < 11 → circles; 11–14 → flat fill; ≥ 14 → fill-extrusion.
// Each feature carries _idx so map clicks can identify the card.
//--------------------------------------------------------------------
function showAllSurveyPropertiesOnMap(properties) {
  _surveyProperties = properties;
  _activeView       = "single";

  const geojson = {
    type:     "FeatureCollection",
    features: properties
      .map((p, idx) => {
        const geom = p.geom || null;
        if (!geom) return null;

        // centroid_lon/lat not returned by /properties endpoint — derive from geometry
        let cLon = p.centroid_lon != null ? Number(p.centroid_lon) : NaN;
        let cLat = p.centroid_lat != null ? Number(p.centroid_lat) : NaN;
        if (!Number.isFinite(cLon) || !Number.isFinite(cLat)) {
          const c = _centroidFromGeom(geom);
          if (c) { cLon = c[0]; cLat = c[1]; }
        }

        return {
          type:     "Feature",
          geometry: geom,
          properties: {
            _idx:         idx,
            centroid_lon: cLon,
            centroid_lat: cLat,
            rent_knn:     p.rent_knn,
            small_n:      p.small_n,
            bld_story:    p.bld_story,
          },
        };
      })
      .filter(Boolean),
  };

  const applyFn = () => {
    clearSurveyPropertiesLayer();
    map.addSource(surveyPropertiesSrcId,   { type: "geojson", data: geojson });
    map.addSource(surveyPropertiesPtSrcId, { type: "geojson", data: _polygonsToPoints(geojson) });

    _addPropertyTripleLayers({
      polySourceId: surveyPropertiesSrcId,
      ptSourceId:   surveyPropertiesPtSrcId,
      circleId:     surveyCircleId,
      fillId:       surveyFillId,
      extId:        surveyExtId,
      colorExpr:    SURVEY_COLOR_DEFAULT,
      useSortKey:   false,
      geojson,
      beforeExtId:  "building3D",
    });

    // Fit map to show all survey properties
    const surveyBounds = getGeojsonBounds(geojson);
    if (surveyBounds) map.fitBounds(surveyBounds, { padding: FIT_PADDING_RECOMMENDATIONS, maxZoom: 13 });

    // Map click on any survey layer → activate the corresponding card
    [surveyCircleId, surveyFillId, surveyExtId].forEach(layerId => {
      map.on("click", layerId, (e) => {
        if (!e.features.length) return;
        const idx = Number(e.features[0].properties._idx);
        if (Number.isFinite(idx) && typeof window.setActiveSurveyCard === "function") {
          window.setActiveSurveyCard(idx);
        }
      });
    });

    // Re-apply any existing highlight after style switch
    if (_surveyHighlightIdx !== null) {
      _updateSurveyHighlight(_surveyHighlightIdx);
    }
  };

  if (!map.isStyleLoaded()) {
    map.once("load", applyFn);
  } else {
    applyFn();
  }
}

//--------------------------------------------------------------------
// _updateSurveyHighlight  – repaint survey layers so _idx === idx is
// shown in the selected color and all others use the default color.
//--------------------------------------------------------------------
function _updateSurveyHighlight(idx) {
  _surveyHighlightIdx = idx;
  const colorExpr = ["case", ["==", ["get", "_idx"], idx],
    SURVEY_COLOR_SELECTED,
    SURVEY_COLOR_DEFAULT,
  ];
  if (map.getLayer(surveyCircleId)) {
    map.setPaintProperty(surveyCircleId, "circle-color", colorExpr);
    map.setPaintProperty(surveyCircleId, "circle-stroke-color", colorExpr);
  }
  if (map.getLayer(surveyFillId)) {
    map.setPaintProperty(surveyFillId, "fill-color", colorExpr);
  }
  if (map.getLayer(surveyExtId)) {
    map.setPaintProperty(surveyExtId, "fill-extrusion-color", colorExpr);
  }
}

window.highlightSurveyPropertyOnMap = _updateSurveyHighlight;

//--------------------------------------------------------------------
// clearSurveyPropertiesLayer  – remove the survey property layers/sources
//--------------------------------------------------------------------
function clearSurveyPropertiesLayer() {
  [surveyExtId, surveyFillId, surveyCircleId].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource(surveyPropertiesSrcId))   map.removeSource(surveyPropertiesSrcId);
  if (map.getSource(surveyPropertiesPtSrcId)) map.removeSource(surveyPropertiesPtSrcId);
  _surveyHighlightIdx = null;
}

//--------------------------------------------------------------------
// showSinglePropertyOnMap  – fly to a survey property's centroid.
// All 10 geometries are already displayed by showAllSurveyPropertiesOnMap.
//--------------------------------------------------------------------
function showSinglePropertyOnMap(property) {
  _singlePropertyObj = property;
  let lon = Number(property.centroid_lon);
  let lat = Number(property.centroid_lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    const c = _centroidFromGeom(property.geom || null);
    if (c) { lon = c[0]; lat = c[1]; }
  }
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
    let lon = Number(prop.centroid_lon);
    let lat = Number(prop.centroid_lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      const c = _centroidFromGeom(prop.geom || null);
      if (c) { lon = c[0]; lat = c[1]; }
    }
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

//--------------------------------------------------------------------
// _attachExplainClickPopup
// On layer click: closes any previous explain popup, opens a new one
// at the click location with property info + Explain button.
// The LLM response is rendered inside the popup below the button.
//--------------------------------------------------------------------
function _attachExplainClickPopup(layerId) {
  map.on("click", layerId, (e) => {
    if (!e.features.length) return;
    const props = e.features[0].properties;

    // Close previous popup
    if (_explainClickPopup) { _explainClickPopup.remove(); _explainClickPopup = null; }

    // Build popup DOM
    const container = document.createElement("div");
    container.className = "explain-popup-inner";

    const btn = document.createElement("button");
    btn.className   = "explain-btn";
    btn.textContent = "Explain";
    container.appendChild(btn);

    const responseEl = document.createElement("div");
    responseEl.className = "explain-response";
    container.appendChild(responseEl);

    btn.addEventListener("click", () => {
      if (typeof window.triggerExplain === "function") {
        window.triggerExplain(props, container);
      }
    });

    _explainClickPopup = new maplibregl.Popup({
      closeButton:  true,
      closeOnClick: false,
      maxWidth:     "260px",
      offset:       12,
    })
      .setLngLat(e.lngLat)
      .setDOMContent(container)
      .addTo(map);

    _explainClickPopup.on("close", () => { _explainClickPopup = null; });
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
// Internal: clear and rebuild recommendation layers using triple-zoom scheme.
//--------------------------------------------------------------------
function _applyRecommendationLayers(geojsonObj, colorExpr, fitPadding) {
  const applyFn = () => {
    if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }

    [propExtId, propFillId, propCircleId].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(propertiesSourceId))        map.removeSource(propertiesSourceId);
    if (map.getSource(recommendationsPointSrcId)) map.removeSource(recommendationsPointSrcId);

    map.addSource(propertiesSourceId,        { type: "geojson", data: geojsonObj });
    map.addSource(recommendationsPointSrcId, { type: "geojson", data: _polygonsToPoints(geojsonObj) });

    _addPropertyTripleLayers({
      polySourceId: propertiesSourceId,
      ptSourceId:   recommendationsPointSrcId,
      circleId:     propCircleId,
      fillId:       propFillId,
      extId:        propExtId,
      colorExpr,
      useSortKey:   true,
      geojson:      geojsonObj,
      beforeExtId:  "building3D",
    });

    // Attach hover tooltips, click highlight, and explain popup to all three layers
    [propFillId, propExtId, propCircleId].forEach(id => {
      _attachHoverTooltip(id);
      _attachClickHighlight(id);
      _attachExplainClickPopup(id);
    });

    _attachMapEmptyClickHandler();

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
  // Clean up survey stage artefacts before showing final results
  clearSurveyPropertiesLayer();
  clearSurveyPin();

  _currentRecommendationsGeojson = geojson;
  _activeChoroplethModeId        = DEFAULT_CHOROPLETH_MODE_ID;
  _activeView                    = "recommendations";

  const defMode = _getChoroplethModes().find(m => m.id === DEFAULT_CHOROPLETH_MODE_ID);
  const { expr: colorExpr } = _buildColorExpr(geojson, defMode);

  _applyRecommendationLayers(geojson, colorExpr, FIT_PADDING_RECOMMENDATIONS);
  _initModeDropdown();
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
    const activeLayers = [propExtId, propFillId, propCircleId].filter(id => map.getLayer(id));
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
  let lon = Number(props.centroid_lon);
  let lat = Number(props.centroid_lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    const c = _centroidFromGeom(props.geom || null);
    if (c) { lon = c[0]; lat = c[1]; }
  }
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
    const mode = _getChoroplethModes().find(m => m.id === _activeChoroplethModeId);
    const { expr: colorExpr } = _buildColorExpr(_currentRecommendationsGeojson, mode);
    _applyRecommendationLayers(_currentRecommendationsGeojson, colorExpr, FIT_PADDING_RECOMMENDATIONS);
    _initModeDropdown();
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
  const mode = _getChoroplethModes().find(m => m.id === modeId);
  if (!mode || !geojsonObj) return [];
  return _buildColorExpr(geojsonObj, mode).stops;
};
