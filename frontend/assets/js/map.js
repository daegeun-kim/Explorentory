// map.js
// MapLibre GL initialization and map rendering functions.

//--------------------------------------------------------------------
// Map instance
//--------------------------------------------------------------------
const map = new maplibregl.Map({
  container: "map",
  style:     "assets/js/style.json",
  center:    [-74, 40.7],
  zoom:      9.5,
});

window.map = map;

//--------------------------------------------------------------------
// Source / layer ids — properties
//--------------------------------------------------------------------
const propertiesSourceId = "properties";
const propertiesFillId   = "properties-fill";
const propertiesCircleId = "properties-circle";

//--------------------------------------------------------------------
// Source / layer ids — neighborhoods
//--------------------------------------------------------------------
const neighborhoodSourceId       = "neighborhoods";
const neighborhoodFillId         = "neighborhoods-fill";
const neighborhoodOutlineId      = "neighborhoods-outline";
const neighborhoodSelectedSrcId  = "neighborhood-selected";
const neighborhoodSelectedFillId = "neighborhood-selected-fill";

// 3-stop choropleth gradient for recommendation scores (cold → hot)
// Stops: min, median, max
const CHOROPLETH_COLORS = ["#86d3ff", "#ffffbf", "#ff7b7b"];

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
  if (map.getLayer(propertiesFillId))   map.removeLayer(propertiesFillId);
  if (map.getLayer(propertiesCircleId)) map.removeLayer(propertiesCircleId);
  if (map.getSource(propertiesSourceId)) map.removeSource(propertiesSourceId);
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
  if (med <= min) med = min + 1e-9;
  if (max <= med) max = med + 1e-9;

  return { min, median: med, max };
}

//--------------------------------------------------------------------
// Internal: clear old property layers/source, add fresh source + layer
//--------------------------------------------------------------------
function _applyLayer(geojsonObj, colorExpr, fitPadding) {
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
          "fill-opacity":       0.85,
          "fill-outline-color": "#ffffff",
        },
      });
    } else {
      map.addLayer({
        id:     propertiesCircleId,
        type:   "circle",
        source: propertiesSourceId,
        paint: {
          "circle-radius":       7,
          "circle-color":        colorExpr,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity":      0.9,
        },
      });
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
        "fill-color":   "#63adf2",
        "fill-opacity": 0.06,
      },
    });

    // Visible boundary outlines
    map.addLayer({
      id:     neighborhoodOutlineId,
      type:   "line",
      source: neighborhoodSourceId,
      paint: {
        "line-color":   "#63adf2",
        "line-width":   1.2,
        "line-opacity": 0.75,
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

      const lon = feature.properties.centroid_lon;
      const lat = feature.properties.centroid_lat;

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
          "fill-color":   "#63adf2",
          "fill-opacity": 0.4,
        },
      });

      if (typeof window.onNeighborhoodClick === "function") {
        window.onNeighborhoodClick(name, lon, lat);
      }
    });

    map.on("mouseenter", neighborhoodFillId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", neighborhoodFillId, () => {
      map.getCanvas().style.cursor = "";
    });

    const bounds = getGeojsonBounds(geojson);
    if (bounds) map.fitBounds(bounds, { padding: 40 });
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

  _applyLayer(geojson, "#63adf2", 120);
}

//--------------------------------------------------------------------
// showRecommendationsOnMap  – top 1000, 3-stop choropleth by score
//--------------------------------------------------------------------
function showRecommendationsOnMap(geojson) {
  const q = _getQuantiles(geojson, "predicted_score");

  let colorExpr = CHOROPLETH_COLORS[1];
  if (q) {
    colorExpr = [
      "interpolate", ["linear"], ["get", "predicted_score"],
      q.min,    CHOROPLETH_COLORS[0],
      q.median, CHOROPLETH_COLORS[1],
      q.max,    CHOROPLETH_COLORS[2],
    ];
  }

  _applyLayer(geojson, colorExpr, 40);
}

//--------------------------------------------------------------------
// Expose to other scripts
//--------------------------------------------------------------------
window.showNeighborhoodsOnMap   = showNeighborhoodsOnMap;
window.clearNeighborhoodLayer   = clearNeighborhoodLayer;
window.showSinglePropertyOnMap  = showSinglePropertyOnMap;
window.showRecommendationsOnMap = showRecommendationsOnMap;
window.clearAllSources          = clearAllSources;
