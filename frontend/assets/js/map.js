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
    colors: ["#ff1f1f", "#ff7215", "#ffffff", "#adff41", "#00b344"],
  },
  {
    id: "rent",    label: "Rent",       col: "rent_knn",    stops: 5,
    colors: ["#001a53", "#002fb1", "#167bff", "#33cfff", "#ffffff"],
  },
  {
    id: "sqft",    label: "Sqft",       col: "sqft",        stops: 5,
    colors: ["#00575a", "#0098b3", "#00c1cf", "#0dffd7", "#ffffff"],
  },
  {
    id: "built",   label: "Built Year", col: "built_year",  stops: 5,
    colors: ["#501900", "#b93500f8", "#ff5917", "#ff985d", "#ffffff"],
  },
  {
    id: "stories", label: "Stories",    col: "bld_story",   stops: 5,
    colors: ["#4b0055", "#9300a7", "#f713ff", "#ff75ff", "#ffffff"],
  },
];
const DEFAULT_CHOROPLETH_MODE_ID = "score";

// fitBounds padding (px) for each view
const FIT_PADDING_SINGLE          = 120;  // one property during rating
const FIT_PADDING_NEIGHBORHOODS   = 40;   // all neighborhoods
const FIT_PADDING_RECOMMENDATIONS = 40;   // top-N results

// Max zoom when fitting to a single property (prevents zooming into one building footprint)
const SINGLE_PROP_MAX_ZOOM = 17;

// Property layer paint values
const PROP_FILL_OPACITY         = 1;
const PROP_FILL_OUTLINE_COLOR   = "#ffffff";
const PROP_CIRCLE_RADIUS        = 2;
const PROP_CIRCLE_STROKE_COLOR  = "#ffffff";
const PROP_CIRCLE_STROKE_WIDTH  = 1.5;
const PROP_CIRCLE_OPACITY       = 0.9;

// Neighborhood layer paint values
const NEIGHBORHOOD_COLOR                  = "#63adf2";
const NEIGHBORHOOD_FILL_OPACITY           = 0.06;
const NEIGHBORHOOD_LINE_WIDTH             = 1.2;
const NEIGHBORHOOD_LINE_OPACITY           = 0.75;
const NEIGHBORHOOD_SELECTED_FILL_OPACITY  = 0.4;

// Single-property highlight color (rating step)
const SINGLE_PROP_COLOR = "#63adf2";

// Zoom level at which recommendations switch from circles (zoomed out)
// to polygon fills (zoomed in)
const RECOMMENDATIONS_POLYGON_MIN_ZOOM = 12;

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
});

window.map = map;

// Shared hover popup instance for recommendation tooltips
let _hoverPopup = null;

// Store last recommendation GeoJSON for mode switching
let _currentRecommendationsGeojson = null;
let _activeChoroplethModeId = DEFAULT_CHOROPLETH_MODE_ID;

//--------------------------------------------------------------------
// Source / layer ids — properties
//--------------------------------------------------------------------
const propertiesSourceId       = "properties";
const propertiesFillId         = "properties-fill";
const propertiesCircleId       = "properties-circle";
const recommendationsPointSrcId = "recommendations-points";

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
  map.getCanvas().style.cursor = "";
}

//--------------------------------------------------------------------
// clearAllSources  (called from main.js on reset)
//--------------------------------------------------------------------
function clearAllSources() {
  clearNeighborhoodLayer();
  if (map.getLayer(propertiesFillId))    map.removeLayer(propertiesFillId);
  if (map.getLayer(propertiesCircleId))  map.removeLayer(propertiesCircleId);
  if (map.getSource(propertiesSourceId)) map.removeSource(propertiesSourceId);
  if (map.getSource(recommendationsPointSrcId)) map.removeSource(recommendationsPointSrcId);
  if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }

  _currentRecommendationsGeojson = null;
  _activeChoroplethModeId = DEFAULT_CHOROPLETH_MODE_ID;
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
    map.setPaintProperty(propertiesFillId, "fill-color",         colorExpr);
    map.setPaintProperty(propertiesFillId, "fill-outline-color", colorExpr);
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
    // Clear only property layers (not neighborhood layers)
    if (map.getLayer(propertiesFillId))   map.removeLayer(propertiesFillId);
    if (map.getLayer(propertiesCircleId)) map.removeLayer(propertiesCircleId);
    if (map.getSource(propertiesSourceId)) map.removeSource(propertiesSourceId);

    map.addSource(propertiesSourceId, { type: "geojson", data: geojsonObj });

    if (_isPolygon(geojsonObj)) {
      map.addLayer({
        id:     propertiesFillId,
        type:   "fill",
        source: propertiesSourceId,
        paint: {
          "fill-color":         colorExpr,
          "fill-opacity":       PROP_FILL_OPACITY,
          "fill-outline-color": PROP_FILL_OUTLINE_COLOR,
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
          "circle-stroke-color": PROP_CIRCLE_STROKE_COLOR,
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
  const applyFn = () => {
    clearNeighborhoodLayer();

    map.addSource(neighborhoodSourceId, { type: "geojson", data: geojson });

    // Subtle fill makes polygons clickable
    map.addLayer({
      id:     neighborhoodFillId,
      type:   "fill",
      source: neighborhoodSourceId,
      paint: {
        "fill-color":   NEIGHBORHOOD_COLOR,
        "fill-opacity": NEIGHBORHOOD_FILL_OPACITY,
      },
    });

    // Visible boundary outlines
    map.addLayer({
      id:     neighborhoodOutlineId,
      type:   "line",
      source: neighborhoodSourceId,
      paint: {
        "line-color":   NEIGHBORHOOD_COLOR,
        "line-width":   NEIGHBORHOOD_LINE_WIDTH,
        "line-opacity": NEIGHBORHOOD_LINE_OPACITY,
      },
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
          "fill-color":   NEIGHBORHOOD_COLOR,
          "fill-opacity": NEIGHBORHOOD_SELECTED_FILL_OPACITY,
        },
      });

      if (typeof window.onNeighborhoodClick === "function") {
        window.onNeighborhoodClick(name, lon, lat, borocode);
      }
    });

    map.on("mouseenter", neighborhoodFillId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", neighborhoodFillId, () => {
      map.getCanvas().style.cursor = "";
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
// showSinglePropertyOnMap  – one property during the rating step
//--------------------------------------------------------------------
function showSinglePropertyOnMap(property) {
  const geojson = {
    type:     "FeatureCollection",
    features: [{
      type:     "Feature",
      geometry: property.geom,
      properties: {
        rent_knn:    property.rent_knn,
        sqft:        property.sqft,
        bedroomnum:  property.bedroomnum,
        bathroomnum: property.bathroomnum,
        small_n:     property.small_n,
      },
    }],
  };

  _applyLayer(geojson, SINGLE_PROP_COLOR, FIT_PADDING_SINGLE, { maxZoom: SINGLE_PROP_MAX_ZOOM });
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

    // Fill layer — visible only when zoomed IN
    // fill-sort-key: higher final_score rendered on top
    map.addLayer({
      id:      propertiesFillId,
      type:    "fill",
      source:  propertiesSourceId,
      minzoom: RECOMMENDATIONS_POLYGON_MIN_ZOOM,
      layout: {
        "fill-sort-key": ["get", SCORE_PROPERTY],
      },
      paint: {
        "fill-color":         colorExpr,
        "fill-opacity":       PROP_FILL_OPACITY,
        "fill-outline-color": colorExpr,  // border matches fill
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
  _activeChoroplethModeId = DEFAULT_CHOROPLETH_MODE_ID;

  const defMode = CHOROPLETH_MODES.find(m => m.id === DEFAULT_CHOROPLETH_MODE_ID);
  const { expr: colorExpr } = _buildColorExpr(geojson, defMode);

  _applyRecommendationLayers(geojson, colorExpr, FIT_PADDING_RECOMMENDATIONS);
  _initModeButtons();
}

//--------------------------------------------------------------------
// Expose to other scripts
//--------------------------------------------------------------------
window.showNeighborhoodsOnMap   = showNeighborhoodsOnMap;
window.clearNeighborhoodLayer   = clearNeighborhoodLayer;
window.showSinglePropertyOnMap  = showSinglePropertyOnMap;
window.showRecommendationsOnMap = showRecommendationsOnMap;
window.clearAllSources          = clearAllSources;
window.updateChoroplethMode     = updateChoroplethMode;

window.getColorStopsForMode = function (geojsonObj, modeId) {
  const mode = CHOROPLETH_MODES.find(m => m.id === modeId);
  if (!mode || !geojsonObj) return [];
  return _buildColorExpr(geojsonObj, mode).stops;
};
