const map = new maplibregl.Map({
        container: 'map',
        style: 'assets/js/style.json',
        center: [-74, 40.7],
        zoom: 9.5
    });

const mapLeft = new maplibregl.Map({
        container: 'map-left',
        style: 'assets/js/style.json',
        center: [-74, 40.7],
        zoom: 9.5
    });

const mapRight = new maplibregl.Map({
        container: 'map-right',
        style: 'assets/js/style.json',
        center: [-74, 40.7],
        zoom: 9.5
    });

// map.scrollZoom.disable();
// map.boxZoom.disable();
// map.dragRotate.disable();
// map.dragPan.disable();
// map.keyboard.disable();
// map.doubleClickZoom.disable();
// map.touchZoomRotate.disable();

window.map = map;

//--------------------------------------------------------------------
//---------------------- Map source / layer ids ----------------------
//--------------------------------------------------------------------
const buildingsSourceId = "buildings";
const buildingsLayerId = "buildings-fill";
const leftSourceId = "buildings-left";
const rightSourceId = "buildings-right";
const leftLayerId = "buildings-fill-left";
const rightLayerId = "buildings-fill-right";

//--------------------------------------------------------------------
//---------------------- Clear all map sources -----------------------
//--------------------------------------------------------------------
function clearAllSources() {
  console.log("[map] clearAllSources called");
  if (typeof map !== "undefined" && map && map.getSource(buildingsSourceId)) {
    console.log("[map] clearing main map source/layer");
    if (map.getLayer(buildingsLayerId)) map.removeLayer(buildingsLayerId);
    map.removeSource(buildingsSourceId);
  }
  if (typeof mapLeft !== "undefined" && mapLeft && mapLeft.getSource(leftSourceId)) {
    console.log("[map] clearing left map source/layer");
    if (mapLeft.getLayer(leftLayerId)) mapLeft.removeLayer(leftLayerId);
    mapLeft.removeSource(leftSourceId);
  }
  if (typeof mapRight !== "undefined" && mapRight && mapRight.getSource(rightSourceId)) {
    console.log("[map] clearing right map source/layer");
    if (mapRight.getLayer(rightLayerId)) mapRight.removeLayer(rightLayerId);
    mapRight.removeSource(rightSourceId);
  }
}

//--------------------------------------------------------------------
//------------------- Helper: stats for color ramp -------------------
//--------------------------------------------------------------------
function getStats(geojsonObj, col) {
  console.log("[stats] getStats called for column:", col);
  const positiveValues = [];
  for (const f of geojsonObj.features) {
    const v = Number(f.properties[col]);
    if (Number.isFinite(v) && v > 0) positiveValues.push(v);
  }
  console.log("[stats] positiveValues length:", positiveValues.length);
  if (!positiveValues.length) return null;

  positiveValues.sort((a, b) => a - b);

  function percentile(p) {
    const idx = (p / 100) * (positiveValues.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return positiveValues[lo];
    const t = idx - lo;
    return positiveValues[lo] * (1 - t) + positiveValues[hi] * t;
  }

  const result = {
    min: positiveValues[0],
    p20: percentile(20),
    p35: percentile(35),
    median: percentile(50),
    p80: percentile(75),
    p90: percentile(90),
    p97: percentile(97),
    max: positiveValues[positiveValues.length - 1]
  };
  console.log("[stats] computed stats:", result);
  return result;
}

//--------------------------------------------------------------------
//---------------------- Apply data: map -----------------------------
//--------------------------------------------------------------------

function applyDataSingle(geojsonObj, col, mode, dtype) {
  console.log("[map] applyDataSingle", {
    col,
    mode,
    dtype,
    featureCount: geojsonObj && geojsonObj.features ? geojsonObj.features.length : 0
  });

  let fillColorExpr = "#555";

  //------------------ ANALYZE or SEARCH + NUMERIC ------------------------
  if ((mode === "analyze" || mode === "search") && dtype === "numeric") {
    const stats = getStats(geojsonObj, col);

    if (stats) {
      console.log("[map] using numeric ramp with stats:", stats);
      const rampExpr = [
        "interpolate",
        ["linear"],
        ["get", col],
        stats.min, "#ffffffff",
        stats.p20, "#fffd6eff",
        stats.p35, "#7dff7dff",
        stats.median, "#60faffff",
        stats.p80, "#39b0ffff",
        stats.p90, "#215cffff",
        stats.p97, "#9845ffff",
        stats.max, "#da60ffff"
      ];

      fillColorExpr = [
        "case",
        ["==", ["get", col], 0],
        "#757575ff",
        rampExpr
      ];
    } else {
      console.warn("[map] stats is null for numeric analyze, keeping default fillColorExpr");
    }
  }


  //---------------- ANALYZE or SEARCH + CATEGORICAL ----------------------
  if ((mode === "analyze" || mode === "search" ) && dtype === "categorical") {
    console.log("[map] building categorical match expression");
    const countsMap = new Map();
    for (const f of geojsonObj.features || []) {
      if (!f.properties) continue;
      const v = f.properties[col];
      if (v == null || v === "") continue;
      countsMap.set(v, (countsMap.get(v) || 0) + 1);
    }

    const counts = Array.from(countsMap.entries()).sort((a, b) => b[1] - a[1]);
    console.log("[map] category counts:", counts);

    if (counts.length) {
      const baseColors = [
        "#ff7474ff",
        "#55dce6ff",
        "#3986ebff",
        "#ddc763ff",
        "#76df84ff",
        "#7652b9ff",
        "#a300eeff",
        "#ff7a62ff",
        "#f3e962ff",
        "#00c896ff"
      ];

      const matchExpr = ["match", ["to-string", ["get", col]]];

      counts.forEach((pair, i) => {
        const cat = pair[0];
        const key = String(cat);
        let color;
        if (i < baseColors.length) {
          color = baseColors[i];
        } else {
          const r = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
          const g = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
          const b = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
          color = `#${r}${g}${b}ff`;
        }
        matchExpr.push(key, color);
      });

      matchExpr.push("#757575ff");
      fillColorExpr = matchExpr;
    } else {
      console.warn("[map] no categories found, keeping default fillColorExpr");
    }
  }


  //---------------- APPLY SOURCE + LAYER -----------------------
  if (map.getSource(buildingsSourceId)) {
    console.log("[map] updating existing buildings source");
    map.getSource(buildingsSourceId).setData(geojsonObj);
    map.setPaintProperty(buildingsLayerId, "fill-color", fillColorExpr);
  } else {
    console.log("[map] adding new buildings source/layer");
    map.addSource(buildingsSourceId, {
      type: "geojson",
      data: geojsonObj
    });

    map.addLayer({
      id: buildingsLayerId,
      type: "fill",
      source: buildingsSourceId,
      paint: {
        "fill-color": fillColorExpr,
        "fill-opacity": 0.7
      }
    });
  }

  //---------------------- FIT TO DATA ---------------------------
  const bounds = getGeojsonBounds(geojsonObj);
  console.log("[map] computed bounds:", bounds);
  if (bounds) map.fitBounds(bounds, { padding: 20 });
}

//--------------------------------------------------------------------
//---------------------- Apply data: compare maps --------------------
//--------------------------------------------------------------------
function applyDataCompare(geojsonLeftData, geojsonRightData, col, fillColorExpr) {
  console.log("[compare] applyDataCompare entered", {
    col,
    leftFeatures: geojsonLeftData && geojsonLeftData.features ? geojsonLeftData.features.length : 0,
    rightFeatures: geojsonRightData && geojsonRightData.features ? geojsonRightData.features.length : 0,
    hasMapLeft: typeof mapLeft !== "undefined" && !!mapLeft,
    hasMapRight: typeof mapRight !== "undefined" && !!mapRight
  });

  if (!mapLeft || !mapRight) {
    console.warn("[compare] mapLeft or mapRight missing");
    return;
  }

  if (mapLeft.getSource(leftSourceId)) {
    console.log("[compare] updating left source");
    mapLeft.getSource(leftSourceId).setData(geojsonLeftData);
    mapLeft.setPaintProperty(leftLayerId, "fill-color", fillColorExpr);
  } else {
    console.log("[compare] adding left source/layer");
    mapLeft.addSource(leftSourceId, {
      type: "geojson",
      data: geojsonLeftData
    });
    mapLeft.addLayer({
      id: leftLayerId,
      type: "fill",
      source: leftSourceId,
      paint: {
        "fill-color": fillColorExpr,
        "fill-opacity": 0.7
      }
    });
  }

  if (mapRight.getSource(rightSourceId)) {
    console.log("[compare] updating right source");
    mapRight.getSource(rightSourceId).setData(geojsonRightData);
    mapRight.setPaintProperty(rightLayerId, "fill-color", fillColorExpr);
  } else {
    console.log("[compare] adding right source/layer");
    mapRight.addSource(rightSourceId, {
      type: "geojson",
      data: geojsonRightData
    });
    mapRight.addLayer({
      id: rightLayerId,
      type: "fill",
      source: rightSourceId,
      paint: {
        "fill-color": fillColorExpr,
        "fill-opacity": 0.7
      }
    });
  }

  const boundsLeft = getGeojsonBounds(geojsonLeftData);
  const boundsRight = getGeojsonBounds(geojsonRightData);
  console.log("[compare] boundsLeft:", boundsLeft, "boundsRight:", boundsRight);

  if (boundsLeft) mapLeft.fitBounds(boundsLeft, { padding: 20 });
  if (boundsRight) mapRight.fitBounds(boundsRight, { padding: 20 });
}



//--------------------------------------------------------------------
//---------------------- Helper: GeoJSON bounds ----------------------
//--------------------------------------------------------------------
function getGeojsonBounds(geojsonObj) {
  console.log("[bounds] getGeojsonBounds called");
  if (!geojsonObj || !geojsonObj.features || !geojsonObj.features.length) {
    console.warn("[bounds] invalid or empty geojsonObj");
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function extend(coords) {
    for (const c of coords) {
      if (Array.isArray(c[0])) {
        extend(c);
      } else {
        const x = c[0];
        const y = c[1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  for (const f of geojsonObj.features) {
    if (f.geometry && f.geometry.coordinates) extend(f.geometry.coordinates);
  }

  if (minX === Infinity) {
    console.warn("[bounds] no valid coordinates found");
    return null;
  }
  const result = [[minX, minY], [maxX, maxY]];
  console.log("[bounds] computed bounds:", result);
  return result;
}