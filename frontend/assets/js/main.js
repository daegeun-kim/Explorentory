//--------------------------------------------------------------------
//-------------------------- DOM references --------------------------
//--------------------------------------------------------------------
const form = document.getElementById("query-form");
const input = document.getElementById("query-input");
const outputBox = document.getElementById("output-message");
const resetBtn = document.getElementById("reset");

const singleMapDiv = document.getElementById("map");
const mapLeftDiv = document.getElementById("map-left");
const mapRightDiv = document.getElementById("map-right");
const singleMapContainer = document.getElementById("single-map-container");
const compareMapContainer = document.getElementById("compare-map-container");

//--------------------------------------------------------------------
//--------------------------- Input Text -----------------------------
//--------------------------------------------------------------------

if (input) {
  input.setAttribute("rows", "1");
  input.style.overflow = "hidden";

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (form.requestSubmit) {
        form.requestSubmit();
      } else {
        form.submit();
      }
    }
  });
}

//--------------------------------------------------------------------
//--------------------------- Global state ---------------------------
//--------------------------------------------------------------------
let currentMode = null;
let geojson = null;
let geojsonList = null;
let explanation = "";
let columnName = null;
let scale = null;
let chatHistory = [];
let dtype = null;
let mapLoadingOverlay = null;

//--------------------------------------------------------------------
//------------------------- Chat UI helpers --------------------------
//--------------------------------------------------------------------
function appendMessage(text, type) {
  console.log("[appendMessage]", { type, text });
  const msg = document.createElement("div");
  msg.classList.add("chat-message");
  if (type === "user") {
    msg.classList.add("chat-message-user");
  } else {
    msg.classList.add("chat-message-bot");
  }
  msg.textContent = text;
  outputBox.appendChild(msg);
  outputBox.scrollTop = outputBox.scrollHeight;
}

//--------------------------------------------------------------------
//---------------- Debug cache restore (charts only) -----------------
//--------------------------------------------------------------------
// const analyzeCache = localStorage.getItem("analyzeCache");
// console.log("[cache] analyzeCache raw:", analyzeCache);

// if (analyzeCache) {
//   const cache = JSON.parse(analyzeCache);
//   console.log("[cache] parsed:", cache);
//   currentMode = cache.mode || "analyze";
//   columnName = cache.column || null;
//   explanation = cache.explanation || "";
//   scale = cache.scale || null;
//   dtype = cache.dtype || null;

//   console.log("[cache] restoring UI from cache", {
//     currentMode,
//     columnName,
//     scale,
//     dtype
//   });

//   enableSingleLayout();
//   if (explanation) {
//     appendMessage(explanation, "bot");
//   }

//   if (window.renderChart1 && Array.isArray(cache.values) && cache.values.length && dtype) {
//     console.log("[cache] restoring chart1 with", cache.values.length, "values");
//     window.renderChart1("#chart1", cache.values, currentMode, dtype);
//   }
//   if (window.renderChart2 && Array.isArray(cache.values) && cache.values.length && scale) {
//     console.log("[cache] restoring chart2 with", cache.values.length, "values");
//     window.renderChart2("#chart2", cache.values, columnName || cache.column, scale, currentMode, dtype);
//   }
// } else {
//   console.log("[cache] no analyzeCache found");
// }


//--------------------------------------------------------------------
//---------- clear placeholder text function (charts only) -----------
//--------------------------------------------------------------------
function clearPlaceholders() {
  const op = document.getElementById("output-placeholder");
  if (op) op.remove();
  const cp = document.getElementById("chart-placeholder");
  if (cp) cp.remove();
}

function showMapLoading() {
  if (!singleMapDiv) return;

  if (!mapLoadingOverlay) {
    mapLoadingOverlay = document.createElement("div");
    mapLoadingOverlay.id = "map-loading-overlay";

    if (!singleMapDiv.style.position || singleMapDiv.style.position === "") {
      singleMapDiv.style.position = "relative";
    }

    mapLoadingOverlay.style.position = "absolute";
    mapLoadingOverlay.style.top = "0";
    mapLoadingOverlay.style.left = "0";
    mapLoadingOverlay.style.right = "0";
    mapLoadingOverlay.style.bottom = "0";
    mapLoadingOverlay.style.display = "flex";
    mapLoadingOverlay.style.alignItems = "center";
    mapLoadingOverlay.style.justifyContent = "center";
    mapLoadingOverlay.style.background = "rgba(0,0,0,0.35)";
    mapLoadingOverlay.style.zIndex = "10";

    const spinner = document.createElement("div");
    spinner.id = "map-loading-spinner";
    spinner.style.width = "40px";
    spinner.style.height = "40px";
    spinner.style.border = "4px solid rgba(255,255,255,0.3)";
    spinner.style.borderTop = "4px solid #ffffff";
    spinner.style.borderRadius = "50%";
    spinner.style.animation = "mapSpin 1s linear infinite";

    mapLoadingOverlay.appendChild(spinner);
    singleMapDiv.appendChild(mapLoadingOverlay);

    if (!document.getElementById("map-loading-style")) {
      const style = document.createElement("style");
      style.id = "map-loading-style";
      style.textContent = "@keyframes mapSpin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}";
      document.head.appendChild(style);
    }
  } else {
    mapLoadingOverlay.style.display = "flex";
  }
}

function hideMapLoading() {
  if (mapLoadingOverlay) {
    mapLoadingOverlay.style.display = "none";
  }
}

//--------------------------------------------------------------------
//----------------------- Form submit handler ------------------------
//--------------------------------------------------------------------
form.addEventListener("submit", async e => {
  e.preventDefault();
  const q = input.value.trim();
  console.log("[submit] form submitted with query:", q);
  if (!q) {
    console.warn("[submit] empty query, ignoring");
    return;
  }

  clearPlaceholders();
  const chart1 = document.getElementById("chart1");
  const chart2 = document.getElementById("chart2");
  if (chart1) chart1.innerHTML = "";
  if (chart2) chart2.innerHTML = "";

  appendMessage(q, "user");
  input.value = "";
  input.style.height = "auto";

  showMapLoading();

  try {
    console.log("[submit] sending request to backend /analyze");
    const res = await fetch("http://localhost:8000/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, history: chatHistory })
    });

    console.log("[submit] response status:", res.status);
    const data = await res.json();
    console.log("[submit] DATA FROM BACKEND:", data);

    if (data.error) {
      console.warn("[submit] backend returned error:", data.error);
      clearAllSources();
      appendMessage(data.error, "bot");
      hideMapLoading();
      return;
    }

    const mode = data.mode || "analyze";
    currentMode = mode;
    console.log("[submit] mode from backend:", mode);

    if (mode === "compare") {
      enableCompareLayout();
      handleCompareData(data);
    } else {
      enableSingleLayout();
      handleSingleData(data);
    }

    hideMapLoading();
  } catch (err) {
    console.error("[submit] fetch error:", err);
    clearAllSources();
    appendMessage("failed to retrieve data (frontend)", "bot");
    hideMapLoading();
  }
});

if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    console.log("[reset] reset button clicked");
    if (outputBox) {
      outputBox.innerHTML = "";
    }
    chatHistory = [];
    currentMode = null;
    geojson = null;
    geojsonList = null;
    explanation = "";
    columnName = null;
    scale = null;
    dtype = null;

    document.getElementById("output-message").innerHTML =
    '<div id="output-placeholder"><div id="main-placeholder">Ask<br>About<br><br>building<br>Neighborhood<br>borough<br>and the city</div></div>';

    document.getElementById("chart1").innerHTML =
    `
    <div id="chart-placeholder">
      <span id="title-placeholder">GeoEstateChat</span>
      <br>
      <pre>
    "search for the neighborhood with highest average building price"

    "I want to live in the tallest place in brooklyn"

    "which area has highest number of crime per population"
      </pre>
    </div>
    `;

    try {
      console.log("[reset] removing analyzeCache from localStorage");
      localStorage.removeItem("analyzeCache");
    } catch (e) {
      console.warn("[reset] Failed to clear analyzeCache:", e);
    }
    clearAllSources();
    const chart1 = document.getElementById("chart1");
    if (chart1) chart1.innerHTML = "";
    const chart2 = document.getElementById("chart2");
    if (chart2) chart2.innerHTML = "";
    hideMapLoading();
  });
} else {
  console.warn("[reset] resetBtn not found in DOM");
}


//--------------------------------------------------------------------
//-------------------------- Layout toggles --------------------------
//--------------------------------------------------------------------
function enableSingleLayout() {
  console.log("[layout] enableSingleLayout");
  if (typeof singleMapContainer !== "undefined" && singleMapContainer) {
    singleMapContainer.style.display = "block";
  }
  if (compareMapContainer) compareMapContainer.style.display = "none";
  if (singleMapDiv) singleMapDiv.style.display = "block";
  if (mapLeftDiv) mapLeftDiv.style.display = "none";
  if (mapRightDiv) mapRightDiv.style.display = "none";
  if (typeof map !== "undefined" && map) {
    console.log("[layout] resizing single map");
    map.resize();
  } else {
    console.warn("[layout] map not available in enableSingleLayout");
  }
}

function enableCompareLayout() {
  console.log("[layout] enableCompareLayout");
  if (typeof singleMapContainer !== "undefined" && singleMapContainer) {
    singleMapContainer.style.display = "none";
  }
  if (compareMapContainer) compareMapContainer.style.display = "flex";
  if (singleMapDiv) singleMapDiv.style.display = "none";
  if (mapLeftDiv) mapLeftDiv.style.display = "block";
  if (mapRightDiv) mapRightDiv.style.display = "block";
  if (typeof mapLeft !== "undefined" && mapLeft) {
    console.log("[layout] resizing left map");
    mapLeft.resize();
  } else {
    console.warn("[layout] mapLeft not available in enableCompareLayout");
  }
  if (typeof mapRight !== "undefined" && mapRight) {
    console.log("[layout] resizing right map");
    mapRight.resize();
  } else {
    console.warn("[layout] mapRight not available in enableCompareLayout");
  }
}

//--------------------------------------------------------------------
//----------------------- Single-mode handler ------------------------
//--------------------------------------------------------------------
function handleSingleData(data) {
  console.log("[single] handleSingleData", data);
  geojson = data.geojson;
  explanation = data.explanation || "";
  columnName = data.column || getColumnName(geojson);
  scale = data.scale || null;
  dtype = data.dtype || null;
  console.log("[single] parsed fields", {
    columnName,
    scale,
    dtype,
    explanationExists: !!explanation
  });
  updateSingleView();
}

//--------------------------------------------------------------------
//---------------------- Compare-mode handler ------------------------
//--------------------------------------------------------------------
function handleCompareData(data) {
  console.log("[compare] data.geojson shape:", Array.isArray(data.geojson), data.geojson);
  geojsonList = data.geojson || [];
  const expl = data.explanation || [];
  explanation = Array.isArray(expl) ? expl.join("\n\n") : expl || "";
  const g0 = geojsonList[0];
  const g1 = geojsonList[1];
  columnName =
    data.column ||
    (g0 && getColumnName(g0)) ||
    (g1 && getColumnName(g1)) ||
    null;
  dtype = data.dtype || null;
  scale = data.scale || null;

  console.log("[compare] parsed fields", {
    geojsonListLength: geojsonList.length,
    columnName,
    dtype,
    scale,
    explanationExists: !!explanation
  });
  updateCompareView();
}

//--------------------------------------------------------------------
//-------------------- Helper: infer column name ---------------------
//--------------------------------------------------------------------
function getColumnName(geojsonObj) {
  console.log("[helper] getColumnName called");
  if (!geojsonObj || !geojsonObj.features || !geojsonObj.features.length) {
    console.warn("[helper] getColumnName: invalid geojsonObj");
    return null;
  }
  const props = geojsonObj.features[0].properties || {};
  const keys = Object.keys(props);
  const col = keys.length ? keys[0] : null;
  console.log("[helper] inferred column name:", col);
  return col;
}

//---------------------- Update single view (map + charts) ----------------------
function updateSingleView() {
  console.log("[single] updateSingleView start", {
    hasGeojson: !!geojson,
    currentMode,
    dtype,
    columnName
  });

  if (!geojson) {
    console.warn("[single] no geojson in updateSingleView");
    if (typeof map !== "undefined" && map && map.getSource(buildingsSourceId)) {
      if (map.getLayer(buildingsLayerId)) map.removeLayer(buildingsLayerId);
      map.removeSource(buildingsSourceId);
    }
    appendMessage("no data returned", "bot");
    return;
  }

  const col = columnName || getColumnName(geojson);
  if (!col) {
    console.warn("[single] no column found for styling");
    appendMessage("no column found", "bot");
    return;
  }

  if (explanation) {
    appendMessage(explanation, "bot");
  }

  let valuesForCache = [];

  if ((currentMode === "analyze" || currentMode === "search") && window.renderChart1 && dtype) {
    console.log("[single] preparing data for chart1");
    const rawValues = geojson.features
      .map(f => f.properties && f.properties[col]);

    let valuesForChart = [];

    if (dtype === "numeric") {
      valuesForChart = rawValues.filter(v => typeof v === "number" && Number.isFinite(v));
    }
    if (dtype === "categorical") {
      valuesForChart = rawValues.filter(v => v != null && v !== "");
    }

    console.log("[single] chart1 values length:", valuesForChart.length);

    if (valuesForChart.length) {
      window.renderChart1("#chart1", valuesForChart, currentMode, dtype);
      valuesForCache = valuesForChart.slice(0, 5000);
    }
  }

  if (
    (currentMode === "analyze" || currentMode === "search") &&
    window.renderChart2 &&
    geojson &&
    Array.isArray(geojson.features) &&
    col &&
    scale
  ) {
    console.log("[single] rendering chart2", {
      featuresLength: geojson.features.length,
      col,
      scale,
      currentMode
    });
    window.renderChart2(
      "#chart2",
      geojson.features,
      col,
      scale,
      currentMode,
      dtype
    );
  }

  if ((currentMode === "analyze" || currentMode === "search")) {
    const cacheObj = {
      column: col,
      values: valuesForCache,
      explanation: explanation,
      scale: scale,
      mode: currentMode,
      dtype: dtype
    };
    console.log("[single] updating analyzeCache", cacheObj);
    try {
      localStorage.setItem("analyzeCache", JSON.stringify(cacheObj));
    } catch (e) {
      console.warn("[single] Failed to update analyzeCache:", e);
    }
  }

  if (typeof map !== "undefined" && map) {
    console.log("[single] applying data to map, styleLoaded:", map.isStyleLoaded());
    if (!map.isStyleLoaded()) {
      map.once("load", () => {
        console.log("[single] map load event fired, applying data");
        applyDataSingle(geojson, col, currentMode, dtype);
      });
    } else {
      applyDataSingle(geojson, col, currentMode, dtype);
    }
  } else {
    console.warn("[single] Map instance not available when updateSingleView ran");
  }
}

//--------------------------------------------------------------------
//------------------ Update compare view (maps only) -----------------
//--------------------------------------------------------------------

function updateCompareView() {
  console.log("[compare] updateCompareView start", {
    geojsonListType: typeof geojsonList,
    geojsonListLength: geojsonList ? geojsonList.length : 0,
    columnName,
    dtype,
    scale
  });

  if (!geojsonList || geojsonList.length < 3) {
    console.warn("[compare] insufficient geojsonList", geojsonList);
    clearAllSources();
    appendMessage("no data returned for compare mode", "bot");
    return;
  }

  const statsSource = geojsonList[0];
  const gLeft = geojsonList[1];
  const gRight = geojsonList[2];
  const col = columnName;

  console.log("[compare] sources", {
    hasStatsSource: !!statsSource,
    hasLeft: !!gLeft,
    hasRight: !!gRight
  });

  if (!col || !statsSource) {
    console.warn("[compare] no column or statsSource", { col, statsSource });
    clearAllSources();
    appendMessage("no column found for compare mode", "bot");
    return;
  }

  if (explanation) {
    appendMessage(explanation, "bot");
  }

  const stats = getStats(statsSource, col);
  let fillColorExpr;

  if (stats) {
    console.log("[compare] stats for color ramp:", stats);
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
      "#002555ff",
      rampExpr
    ];
  } else {
    console.warn("[compare] getStats returned null, using flat color");
    fillColorExpr = "#555";
  }

  if (!gLeft || !gRight) {
    console.warn("[compare] invalid left/right geojson", { gLeft, gRight });
    clearAllSources();
    appendMessage("invalid geojson payload for compare mode", "bot");
    return;
  }

  let regionLabels = [];
  console.log("[compare] region label extraction start", { scale });

  if (scale) {
    const compareField =
      scale === "city" ? "borocode" :
      scale === "borough" ? "large_n" :
      scale === "large_n" ? "large_n" :
      null;

    console.log("[compare] resolved compareField:", compareField);

    const getRegionFromGeojson = g => {
      if (!g || !Array.isArray(g.features)) {
        console.warn("[compare] getRegionFromGeojson: invalid g", g);
        return null;
      }
      if (!g.features.length) {
        console.warn("[compare] getRegionFromGeojson: empty features");
        return null;
      }
      const sample = g.features[0];
      console.log("[compare] sample feature properties for region", {
        compareField,
        properties: sample && sample.properties
      });

      if (!compareField) return null;
      const withField = g.features.find(
        f => f && f.properties && f.properties[compareField] != null
      );
      return withField ? String(withField.properties[compareField]) : null;
    };

    if (compareField) {
      const r1 = getRegionFromGeojson(gLeft);
      const r2 = getRegionFromGeojson(gRight);
      regionLabels = [r1, r2].filter(v => v != null);
      console.log("[compare] computed regionLabels:", regionLabels);
    } else {
      console.warn("[compare] compareField is null, cannot compute regionLabels");
    }
  } else {
    console.warn("[compare] scale is null, skipping region label extraction");
  }

  window.__debugCompare = {
    geojsonList,
    statsSource,
    gLeft,
    gRight,
    col,
    scale,
    regionLabels
  };
  console.log("[compare] __debugCompare snapshot:", window.__debugCompare);

  if (window.renderChart1 && dtype === "numeric") {
    const values1 = gLeft.features
      .map(f => f.properties && f.properties[col])
      .filter(v => typeof v === "number" && Number.isFinite(v));

    const values2 = gRight.features
      .map(f => f.properties && f.properties[col])
      .filter(v => typeof v === "number" && Number.isFinite(v));

    console.log("[compare] chart1 values lengths:", {
      values1: values1.length,
      values2: values2.length
    });

    console.log("[compare] calling renderChart1 with regions:", regionLabels);

    if (values1.length && values2.length) {
      window.renderChart1("#chart1", [values1, values2], "compare", dtype, regionLabels);
    } else {
      console.warn("[compare] chart1 values missing", { values1, values2 });
    }
  } else {
    console.warn("[compare] renderChart1 not available or dtype != numeric", {
      hasRenderChart1: !!window.renderChart1,
      dtype
    });
  }

  if (
    window.renderChart2 &&
    dtype === "numeric" &&
    statsSource &&
    Array.isArray(statsSource.features) &&
    scale
  ) {
    console.log("[compare] calling renderChart2", {
      featuresLength: statsSource.features.length,
      col,
      scale
    });
    window.renderChart2("#chart2", statsSource.features, col, scale, "compare", dtype);
  } else {
    console.warn("[compare] renderChart2 not called", {
      hasRenderChart2: !!window.renderChart2,
      dtype,
      statsSourceOK: !!statsSource,
      hasFeatures: statsSource && Array.isArray(statsSource.features),
      scale
    });
  }

  console.log("[compare] applyDataCompare call", {
    leftFeatures: gLeft.features ? gLeft.features.length : null,
    rightFeatures: gRight.features ? gRight.features.length : null
  });
  applyDataCompare(gLeft, gRight, col, fillColorExpr);
}
