// main.js
// Orchestration: preferences → neighborhood selection → rating → recommendations.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

const API_BASE = "http://localhost:8000";

//--------------------------------------------------------------------
// DOM references
//--------------------------------------------------------------------
const outputBox          = document.getElementById("output-message");
const resetBtn           = document.getElementById("reset");
const invertBtn          = document.getElementById("color-invert");
const singleMapDiv       = document.getElementById("map");
const singleMapContainer = document.getElementById("single-map-container");

// Color mode toggle: switches between dark (default) and bright mode.
// body.bright applies explicit bright-mode CSS custom properties.
// toggleMapStyle swaps the basemap style file; redrawCharts re-renders
// canvas charts with mode-appropriate colors.
if (invertBtn) {
  invertBtn.addEventListener("click", () => {
    document.body.classList.toggle("bright");
    if (typeof window.toggleMapStyle  === "function") window.toggleMapStyle();
    if (typeof window.redrawCharts    === "function") window.redrawCharts();
  });
}

//--------------------------------------------------------------------
// Global state
//--------------------------------------------------------------------
let currentPreferences = null;
let mapLoadingOverlay  = null;

//--------------------------------------------------------------------
// Stage indicator — 4-step progress bar shown in the sidebar
//--------------------------------------------------------------------
const _STAGE_LABELS = ["Preferences", "Neighborhood", "Rate Properties", "Results"];

function _setStage(num) {
  let bar = document.getElementById("stage-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "stage-bar";
    const msg       = document.getElementById("message");
    const outputMsg = document.getElementById("output-message");
    if (msg && outputMsg) msg.insertBefore(bar, outputMsg);
  }
  bar.innerHTML = _STAGE_LABELS.map((label, i) => {
    const n   = i + 1;
    const cls = n < num ? "stage-step done" : n === num ? "stage-step active" : "stage-step";
    const num_display = n < num ? "✓" : String(n);
    return `<span class="${cls}"><span class="stage-num">${num_display}</span><span class="stage-label">${label}</span></span>`
         + (i < _STAGE_LABELS.length - 1 ? `<span class="stage-sep">›</span>` : "");
  }).join("");
}

//--------------------------------------------------------------------
// Map loading overlay
//--------------------------------------------------------------------
function showMapLoading() {
  if (!singleMapDiv) return;

  if (!mapLoadingOverlay) {
    mapLoadingOverlay = document.createElement("div");
    mapLoadingOverlay.id = "map-loading-overlay";

    const spinner = document.createElement("div");
    spinner.className = "map-spinner";
    mapLoadingOverlay.appendChild(spinner);
    singleMapDiv.appendChild(mapLoadingOverlay);
  } else {
    mapLoadingOverlay.style.display = "flex";
  }
}

function hideMapLoading() {
  if (mapLoadingOverlay) mapLoadingOverlay.style.display = "none";
}

//--------------------------------------------------------------------
// Status message helper
//--------------------------------------------------------------------
function setStatusMessage(text) {
  if (!outputBox) return;
  let msg = document.getElementById("status-message");
  if (msg) {
    msg.textContent = text;
  } else {
    msg = document.createElement("div");
    msg.id        = "status-message";
    msg.className = "chat-message chat-message-bot";
    msg.textContent = text;
    outputBox.innerHTML = "";
    outputBox.appendChild(msg);
  }
}

function clearPlaceholders() {
  const op = document.getElementById("output-placeholder");
  if (op) op.remove();
  // chart-placeholder visibility is managed by initCharts / clearCharts
}

//--------------------------------------------------------------------
// Step 1 – Preferences submitted → load neighborhoods onto map
//--------------------------------------------------------------------
window.onPreferencesSubmit = async function (prefs) {
  currentPreferences = prefs;
  clearPlaceholders();
  _setStage(2);
  showMapLoading();
  setStatusMessage("Loading neighborhoods…");

  try {
    const res  = await fetch(`${API_BASE}/neighborhoods`);
    const data = await res.json();
    hideMapLoading();

    if (data.error) {
      setStatusMessage("Error loading neighborhoods: " + data.error);
      return;
    }

    if (typeof window.showNeighborhoodsOnMap === "function") {
      window.showNeighborhoodsOnMap(data.geojson);
    }

    if (typeof window.showNeighborhoodSelector === "function") {
      window.showNeighborhoodSelector();
    }

  } catch (err) {
    console.error("[neighborhoods]", err);
    hideMapLoading();
    setStatusMessage(`Connection error. Is the backend running on ${API_BASE}?`);
  }
};

//--------------------------------------------------------------------
// Step 2 – Neighborhood confirmed → fetch sample properties
//--------------------------------------------------------------------
window.onNeighborhoodSubmit = async function (neighborhood) {
  _setStage(3);
  // Merge neighborhood centroid coordinates into preferences (not the name)
  currentPreferences = {
    ...currentPreferences,
    neighborhood_lon:      neighborhood.lon,
    neighborhood_lat:      neighborhood.lat,
    neighborhood_borocode: neighborhood.borocode,
  };

  if (typeof window.clearNeighborhoodLayer === "function") {
    window.clearNeighborhoodLayer();
  }

  showMapLoading();
  setStatusMessage(`Finding properties near ${neighborhood.name}…`);

  try {
    const _t0 = performance.now();
    const res  = await fetch(`${API_BASE}/properties`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(currentPreferences),
    });
    const data = await res.json();
    console.log(`[timing] /properties fetch+parse: ${(performance.now() - _t0).toFixed(0)}ms`);
    hideMapLoading();

    if (data.error) {
      setStatusMessage("Error: " + data.error);
      return;
    }

    const sample = data.sample || [];
    if (!sample.length) {
      setStatusMessage("No properties found for your criteria. Try adjusting rent or bedroom/bathroom count.");
      return;
    }

    if (typeof window.showRatingPanel === "function") {
      window.showRatingPanel(sample);
    }

  } catch (err) {
    console.error("[properties]", err);
    hideMapLoading();
    setStatusMessage(`Connection error. Is the backend running on ${API_BASE}?`);
  }
};

//--------------------------------------------------------------------
// Top-10 listing — shown in the right sidebar after recommendations load
//--------------------------------------------------------------------
function _showTop10Listing(geojson) {
  if (!outputBox) return;

  const features = [...geojson.features]
    .sort((a, b) => (Number(b.properties.final_score) || 0) - (Number(a.properties.final_score) || 0))
    .slice(0, 10);

  const wrap = document.createElement("div");
  wrap.id = "top10-listing";

  const hdr = document.createElement("div");
  hdr.className   = "top10-header";
  hdr.textContent = `Top ${features.length} Recommended Properties`;
  wrap.appendChild(hdr);

  features.forEach((f, idx) => {
    const p = f.properties;

    const rent   = p.rent_knn      != null ? `$${Math.round(p.rent_knn).toLocaleString()}/mo` : "—";
    const sqft   = p.sqft          != null ? `${Math.round(p.sqft).toLocaleString()} sqft`    : null;
    const beds   = p.bedroomnum    != null ? `${p.bedroomnum} bd`   : null;
    const baths  = p.bathroomnum   != null ? `${p.bathroomnum} ba`  : null;
    const lvroom = p.livingroomnum != null && Number(p.livingroomnum) > 0 ? `${p.livingroomnum} lr` : null;
    const built  = p.built_year    != null ? `Built ${Math.round(p.built_year)}`          : null;
    const stories= p.bld_story     != null ? `${Math.round(p.bld_story)} fl.`             : null;
    const hood   = p.small_n       || "—";

    const tags = [sqft, beds, baths, lvroom, built, stories].filter(Boolean);

    const card = document.createElement("div");
    card.className = "top10-card";
    card.innerHTML = `
      <div class="top10-card-hood">#${idx + 1}&nbsp;${hood}</div>
      <div class="top10-card-rent">${rent}</div>
      <div class="top10-card-tags">${
        tags.map(t => `<span class="top10-tag">${t}</span>`).join("")
      }</div>`;

    card.addEventListener("click", () => {
      document.querySelectorAll(".top10-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");

      if (typeof window.onPropertyClick       === "function") window.onPropertyClick(p);
      if (typeof window.flyToProperty         === "function") window.flyToProperty(p);
      if (typeof window.highlightPropertyOnMap === "function") window.highlightPropertyOnMap(f);
    });

    wrap.appendChild(card);
  });

  outputBox.innerHTML = "";
  outputBox.appendChild(wrap);
}

//--------------------------------------------------------------------
// Step 3 – Ratings submitted → run model → show top results
//--------------------------------------------------------------------
window.onRatingsSubmit = async function (ratings) {
  if (!currentPreferences) return;

  showMapLoading();
  setStatusMessage("Running recommendation model…");

  try {
    const _t0 = performance.now();
    const res  = await fetch(`${API_BASE}/recommend`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ preferences: currentPreferences, ratings }),
    });
    const data = await res.json();
    const _t1 = performance.now();
    console.log(`[timing] /recommend fetch+parse: ${(_t1 - _t0).toFixed(0)}ms`);
    hideMapLoading();

    if (data.error) {
      setStatusMessage("Error: " + data.error);
      return;
    }

    if (!data.geojson) {
      setStatusMessage("No recommendations returned.");
      return;
    }

    _setStage(4);
    if (typeof window.showRecommendationsOnMap === "function") {
      window.showRecommendationsOnMap(data.geojson);
    }
    const _t2 = performance.now();
    console.log(`[timing] Map layer setup: ${(_t2 - _t1).toFixed(0)}ms`);

    if (window.map) {
      window.map.once("idle", () => {
        console.log(`[timing] Map render complete: ${(performance.now() - _t2).toFixed(0)}ms`);
      });
    }

    if (typeof window.initCharts === "function") {
      window.initCharts(data.geojson);
    }

    _showTop10Listing(data.geojson);

  } catch (err) {
    console.error("[recommend]", err);
    hideMapLoading();
    setStatusMessage(`Connection error. Is the backend running on ${API_BASE}?`);
  }
};

//--------------------------------------------------------------------
// Chart resize handle — drag between map and chart (vertical)
//--------------------------------------------------------------------
const chartResizeHandle = document.getElementById("chart-resize-handle");
let _chartResizing      = false;
let _resizeStartY       = 0;
let _resizeStartMapH    = 0;

if (chartResizeHandle) {
  chartResizeHandle.addEventListener("mousedown", (e) => {
    _chartResizing   = true;
    _resizeStartY    = e.clientY;
    _resizeStartMapH = singleMapContainer ? singleMapContainer.offsetHeight : 0;
    document.body.style.cursor     = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
}

//--------------------------------------------------------------------
// Sidebar resize handle — drag between main-container and input-output (horizontal)
//--------------------------------------------------------------------
const sidebarResizeHandle = document.getElementById("sidebar-resize-handle");
let _sidebarResizing      = false;
let _sidebarResizeStartX  = 0;
let _sidebarResizeStartW  = 0;

if (sidebarResizeHandle) {
  sidebarResizeHandle.addEventListener("mousedown", (e) => {
    _sidebarResizing     = true;
    _sidebarResizeStartX = e.clientX;
    const mainCon = document.getElementById("main-container");
    _sidebarResizeStartW = mainCon ? mainCon.offsetWidth : 0;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
}

document.addEventListener("mousemove", (e) => {
  if (_chartResizing) {
    const delta      = e.clientY - _resizeStartY;
    const mainCon    = document.getElementById("main-container");
    const totalH     = mainCon ? mainCon.offsetHeight : window.innerHeight;
    const handleH    = chartResizeHandle ? chartResizeHandle.offsetHeight : 4;
    const minMapH    = 120;
    const minChartH  = 80;
    const newMapH    = Math.max(minMapH, Math.min(totalH - handleH - minChartH, _resizeStartMapH + delta));

    if (singleMapContainer) {
      singleMapContainer.style.flex   = "none";
      singleMapContainer.style.height = newMapH + "px";
    }
    if (window.map) window.map.resize();
    if (typeof window.resizeCharts === "function") window.resizeCharts();
  }

  if (_sidebarResizing) {
    const delta      = e.clientX - _sidebarResizeStartX;
    const handleW    = sidebarResizeHandle ? sidebarResizeHandle.offsetWidth : 10;
    const totalW     = window.innerWidth;
    const minMainW   = 300;
    const minSideW   = 180;
    const newMainW   = Math.max(minMainW, Math.min(totalW - handleW - minSideW, _sidebarResizeStartW + delta));

    const mainCon = document.getElementById("main-container");
    if (mainCon) {
      mainCon.style.flex  = "none";
      mainCon.style.width = newMainW + "px";
    }
    if (window.map) window.map.resize();
    if (typeof window.resizeCharts === "function") window.resizeCharts();
  }
});

document.addEventListener("mouseup", () => {
  if (_chartResizing) {
    _chartResizing                 = false;
    document.body.style.cursor     = "";
    document.body.style.userSelect = "";
  }
  if (_sidebarResizing) {
    _sidebarResizing               = false;
    document.body.style.cursor     = "";
    document.body.style.userSelect = "";
  }
});

//--------------------------------------------------------------------
// Reset button
//--------------------------------------------------------------------
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    currentPreferences = null;

    if (typeof clearAllSources === "function") clearAllSources();
    if (typeof window.clearCharts === "function") window.clearCharts();
    hideMapLoading();

    if (outputBox) {
      outputBox.innerHTML = `
        <div id="output-placeholder">
          <div id="main-placeholder">Set your<br>preferences<br><br>to find<br>your perfect<br>rental</div>
        </div>`;
    }

    const stageBar = document.getElementById("stage-bar");
    if (stageBar) stageBar.remove();

    if (typeof window.showPreferencesModal === "function") {
      window.showPreferencesModal();
    }
  });
}
