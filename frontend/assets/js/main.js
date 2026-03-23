// main.js
// Orchestration: preferences → neighborhood selection → rating → recommendations.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

const API_BASE = "http://localhost:8000";

// Loading overlay appearance
const OVERLAY_BACKGROUND   = "rgba(0,0,0,0.35)";
const SPINNER_SIZE         = "40px";
const SPINNER_BORDER_WIDTH = "4px";
const SPINNER_BORDER_COLOR = "rgba(255,255,255,0.3)";
const SPINNER_TOP_COLOR    = "#ffffff";
const SPINNER_DURATION     = "1s";

//--------------------------------------------------------------------
// DOM references
//--------------------------------------------------------------------
const outputBox          = document.getElementById("output-message");
const resetBtn           = document.getElementById("reset");
const singleMapDiv       = document.getElementById("map");
const singleMapContainer = document.getElementById("single-map-container");

// Hide the legacy query form — preferences are collected via popup
const queryForm = document.getElementById("query-form");
if (queryForm) queryForm.style.display = "none";

//--------------------------------------------------------------------
// Global state
//--------------------------------------------------------------------
let currentPreferences = null;
let mapLoadingOverlay  = null;

//--------------------------------------------------------------------
// Map loading overlay
//--------------------------------------------------------------------
function showMapLoading() {
  if (!singleMapDiv) return;

  if (!mapLoadingOverlay) {
    mapLoadingOverlay = document.createElement("div");
    mapLoadingOverlay.id = "map-loading-overlay";

    if (!singleMapDiv.style.position) singleMapDiv.style.position = "relative";

    Object.assign(mapLoadingOverlay.style, {
      position:       "absolute",
      top: "0", left: "0", right: "0", bottom: "0",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      background:     OVERLAY_BACKGROUND,
      zIndex:         "10",
    });

    const spinner = document.createElement("div");
    Object.assign(spinner.style, {
      width:        SPINNER_SIZE,
      height:       SPINNER_SIZE,
      border:       `${SPINNER_BORDER_WIDTH} solid ${SPINNER_BORDER_COLOR}`,
      borderTop:    `${SPINNER_BORDER_WIDTH} solid ${SPINNER_TOP_COLOR}`,
      borderRadius: "50%",
      animation:    `mapSpin ${SPINNER_DURATION} linear infinite`,
    });
    mapLoadingOverlay.appendChild(spinner);
    singleMapDiv.appendChild(mapLoadingOverlay);

    if (!document.getElementById("map-loading-style")) {
      const style = document.createElement("style");
      style.id = "map-loading-style";
      style.textContent =
        "@keyframes mapSpin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}";
      document.head.appendChild(style);
    }
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
  const cp = document.getElementById("chart-placeholder");
  if (cp) cp.remove();
}

//--------------------------------------------------------------------
// Step 1 – Preferences submitted → load neighborhoods onto map
//--------------------------------------------------------------------
window.onPreferencesSubmit = async function (prefs) {
  currentPreferences = prefs;
  clearPlaceholders();
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

    const count = data.geojson.features ? data.geojson.features.length : 0;
    setStatusMessage(`Showing top ${count} recommended properties.`);

  } catch (err) {
    console.error("[recommend]", err);
    hideMapLoading();
    setStatusMessage(`Connection error. Is the backend running on ${API_BASE}?`);
  }
};

//--------------------------------------------------------------------
// Reset button
//--------------------------------------------------------------------
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    currentPreferences = null;

    if (typeof clearAllSources === "function") clearAllSources();
    hideMapLoading();

    if (outputBox) {
      outputBox.innerHTML = `
        <div id="output-placeholder">
          <div id="main-placeholder">Set your<br>preferences<br><br>to find<br>your perfect<br>rental</div>
        </div>`;
    }

    const chart1 = document.getElementById("chart1");
    if (chart1) {
      chart1.innerHTML = `
        <div id="chart-placeholder">
          <span id="title-placeholder">Explorentory</span>
        </div>`;
    }

    if (typeof window.showPreferencesModal === "function") {
      window.showPreferencesModal();
    }
  });
}
