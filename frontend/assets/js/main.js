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
let currentPreferences      = null;
let mapLoadingOverlay       = null;
let _currentGeojson         = null;   // full recommendation GeoJSON from /recommend
let _currentOlsCoef         = null;   // OLS coefficients from /recommend
let _activeGeojson          = null;   // currently displayed (may be filtered/sorted)
let _chatHistory            = [];     // [{role, content}] for multi-turn chat

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
  window.currentPreferences = currentPreferences;
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
  currentPreferences = {
    ...currentPreferences,
    neighborhood_name:     neighborhood.name,
    neighborhood_lon:      neighborhood.lon,
    neighborhood_lat:      neighborhood.lat,
    neighborhood_borocode: neighborhood.borocode,
  };
  window.currentPreferences = currentPreferences;

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
// LLM explain helper — calls /explain and renders response into containerEl
//--------------------------------------------------------------------
async function _callExplain(propertyProps, containerEl) {
  if (!currentPreferences) return;

  const btn = containerEl.querySelector(".explain-btn");
  if (btn) btn.disabled = true;

  // Remove any previous response/spinner and show spinner immediately
  let spinnerEl = containerEl.querySelector(".explain-spinner");
  let responseEl = containerEl.querySelector(".explain-response");
  if (spinnerEl)  spinnerEl.remove();
  if (responseEl) responseEl.remove();

  spinnerEl = document.createElement("div");
  spinnerEl.className = "explain-spinner";
  containerEl.appendChild(spinnerEl);

  const userPrefs = {
    target_rent:  currentPreferences.rent,
    bedroomnum:   currentPreferences.bedrooms,
    bathroomnum:  currentPreferences.bathrooms,
    priority:     currentPreferences.priority_order,
    concern:      currentPreferences.concern || "",
    neighborhood: currentPreferences.neighborhood_name || "",
  };

  const propInfo = {
    rent:               propertyProps.rent_knn,
    livingroomnum:      propertyProps.livingroomnum,
    bedroomnum:         propertyProps.bedroomnum,
    bathroomnum:        propertyProps.bathroomnum,
    sqft:               propertyProps.sqft,
    borocode:           propertyProps.borocode,
    built_year:         propertyProps.built_year,
    height_roof:        propertyProps.heightroof,
    small_n:            propertyProps.small_n,
    large_n:            propertyProps.large_n,
    elevator:           propertyProps.elevator,
    bld_story:          propertyProps.bld_story,
    zoning:             propertyProps.zoning,
    bldg_class:         propertyProps.bldg_class,
    bld_type:           propertyProps.bld_type,
    dist_greenspace_ft: propertyProps.dist_greenspace_ft,
    dist_subway_ft:     propertyProps.dist_subway_ft,
    noise_level:        propertyProps.noise_level,
    nearest_major_park: propertyProps.nearest_major_park,
    dist_major_park_ft: propertyProps.dist_major_park_ft,
  };

  let text;
  try {
    const res  = await fetch(`${API_BASE}/explain`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ user_prefs: userPrefs, property_info: propInfo }),
    });
    const data = await res.json();
    text = data.error ? `Error: ${data.error}` : data.explanation;
  } catch (_err) {
    text = "Connection error.";
  }

  // Swap spinner for the response text
  spinnerEl.remove();
  responseEl = document.createElement("div");
  responseEl.className   = "explain-response";
  responseEl.textContent = text;
  containerEl.appendChild(responseEl);

  if (btn) btn.disabled = false;
}

window.triggerExplain = _callExplain;

//--------------------------------------------------------------------
// Results UI — top-10 listing (70%) + chat panel (30%)
//--------------------------------------------------------------------
function _showResultsUI(geojson) {
  if (!outputBox) return;
  outputBox.innerHTML = "";

  // Top listing area (scrollable, takes available space above chat)
  const listingWrap = document.createElement("div");
  listingWrap.id = "top10-listing-wrap";
  _renderTop10Cards(listingWrap, geojson);
  outputBox.appendChild(listingWrap);

  // Drag handle between listing and chat
  const listingChatHandle = document.createElement("div");
  listingChatHandle.id = "listing-chat-handle";
  outputBox.appendChild(listingChatHandle);
  _attachListingChatHandle(listingChatHandle, listingWrap);

  // Chat panel (fixed height at bottom)
  const chatPanel = _buildChatPanel();
  outputBox.appendChild(chatPanel);

  // 2-column layout when sidebar is wide enough
  _attachListingResizeObserver(listingWrap);
}

function _attachListingChatHandle(handle, listingWrap) {
  let resizing = false, startY = 0, startListH = 0;
  handle.addEventListener("mousedown", (e) => {
    resizing    = true;
    startY      = e.clientY;
    startListH  = listingWrap.offsetHeight;
    document.body.style.cursor     = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const delta     = e.clientY - startY;
    const container = outputBox || document.getElementById("output-message");
    const outputH   = container ? container.offsetHeight : window.innerHeight;
    const handleH   = handle.offsetHeight || 6;
    // Compute min chat height from its fixed children so input row never disappears
    const chatPanel   = document.getElementById("chat-panel");
    const explainRow  = document.getElementById("chat-explain-row");
    const inputRow    = document.getElementById("chat-input-row");
    const chatMinH    = (explainRow ? explainRow.offsetHeight : 30)
                      + (inputRow  ? inputRow.offsetHeight   : 38)
                      + 20; // padding + gap
    const maxListH  = outputH - handleH - chatMinH;
    const newListH  = Math.max(60, Math.min(maxListH, startListH + delta));
    const newChatH  = outputH - handleH - newListH;
    listingWrap.style.flex   = "none";
    listingWrap.style.height = newListH + "px";
    if (chatPanel) {
      chatPanel.style.flex   = "none";
      chatPanel.style.height = newChatH + "px";
    }
  });
  document.addEventListener("mouseup", () => {
    if (resizing) {
      resizing = false;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    }
  });
}

function _attachListingResizeObserver(listingWrap) {
  const ioEl = document.getElementById("input-output");
  if (!ioEl || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      if (document.getElementById("top10-listing-wrap")) {
        listingWrap.classList.toggle("wide", w >= 800);
      } else {
        ro.disconnect();
      }
    }
  });
  ro.observe(ioEl);
}

function _renderTop10Cards(container, geojson) {
  container.innerHTML = "";

  const features = [...geojson.features]
    .sort((a, b) => (Number(b.properties.final_score) || 0) - (Number(a.properties.final_score) || 0))
    .slice(0, 10);

  const hdr = document.createElement("div");
  hdr.className   = "top10-header";
  const total = geojson.features.length;
  hdr.textContent = `Top ${features.length} of ${total.toLocaleString()} Properties`;
  container.appendChild(hdr);

  features.forEach((f, idx) => {
    const p = f.properties;

    const rent   = p.rent_knn      != null ? `$${Math.round(p.rent_knn).toLocaleString()}/mo` : "—";
    const sqft   = p.sqft          != null ? `${Math.round(p.sqft).toLocaleString()} sqft`    : null;
    const beds   = p.bedroomnum    != null ? `${p.bedroomnum} bd`   : null;
    const baths  = p.bathroomnum   != null ? `${p.bathroomnum} ba`  : null;
    const lvroom = p.livingroomnum != null && Number(p.livingroomnum) > 0 ? `${p.livingroomnum} lr` : null;
    const hood   = p.small_n       || "—";
    const tags   = [sqft, beds, baths, lvroom].filter(Boolean);

    const card = document.createElement("div");
    card.className = "top10-card";
    card.innerHTML = `
      <div class="top10-card-hood">#${idx + 1}&nbsp;${hood}</div>
      <div class="top10-card-rent">${rent}</div>
      <div class="top10-card-tags">${tags.map(t => `<span class="top10-tag">${t}</span>`).join("")}</div>`;

    card.addEventListener("click", () => {
      document.querySelectorAll(".top10-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      if (typeof window.onPropertyClick        === "function") window.onPropertyClick(p);
      if (typeof window.flyToProperty          === "function") window.flyToProperty(p);
      if (typeof window.highlightPropertyOnMap === "function") window.highlightPropertyOnMap(f);
    });

    const explainBtn = document.createElement("button");
    explainBtn.className   = "explain-btn";
    explainBtn.textContent = "Explain";
    explainBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _callExplain(p, card);
    });
    card.appendChild(explainBtn);
    container.appendChild(card);
  });
}

//--------------------------------------------------------------------
// Chat panel builder
//--------------------------------------------------------------------
function _buildChatPanel() {
  const panel = document.createElement("div");
  panel.id = "chat-panel";

  // Message log
  const log = document.createElement("div");
  log.id = "chat-log";
  panel.appendChild(log);

  // "Explain Result" button row
  const explainRow = document.createElement("div");
  explainRow.id = "chat-explain-row";

  const explainResultBtn = document.createElement("button");
  explainResultBtn.id          = "chat-explain-result-btn";
  explainResultBtn.textContent = "Explain Result";
  explainResultBtn.addEventListener("click", _onExplainResult);
  explainRow.appendChild(explainResultBtn);

  // Reset filter button (hidden until a filter/sort is active)
  const resetFilterBtn = document.createElement("button");
  resetFilterBtn.id          = "chat-reset-filter-btn";
  resetFilterBtn.textContent = "Reset";
  resetFilterBtn.title       = "Reset to original results";
  resetFilterBtn.style.display = "none";
  resetFilterBtn.addEventListener("click", _onResetChatFilter);
  explainRow.appendChild(resetFilterBtn);
  panel.appendChild(explainRow);

  // Input row
  const inputRow = document.createElement("div");
  inputRow.id = "chat-input-row";

  const input = document.createElement("input");
  input.id          = "chat-input";
  input.type        = "text";
  input.placeholder = "Filter or rank properties…";

  const sendBtn = document.createElement("button");
  sendBtn.id          = "chat-send-btn";
  sendBtn.textContent = "Send";

  const doSend = () => {
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    _onChatSend(msg);
  };
  sendBtn.addEventListener("click", doSend);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });

  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  panel.appendChild(inputRow);

  return panel;
}

//--------------------------------------------------------------------
// Chat log helpers
//--------------------------------------------------------------------
function _chatAppend(role, text) {
  const log = document.getElementById("chat-log");
  if (!log) return;
  const el = document.createElement("div");
  el.className = `chat-bubble chat-bubble-${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function _chatShowSpinner() {
  const log = document.getElementById("chat-log");
  if (!log) return null;
  const el = document.createElement("div");
  el.className = "chat-bubble chat-bubble-bot chat-spinner-bubble";
  el.innerHTML = `<span class="explain-spinner"></span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

//--------------------------------------------------------------------
// Explain Result
//--------------------------------------------------------------------
async function _onExplainResult() {
  if (!currentPreferences || !_currentOlsCoef) return;
  const btn = document.getElementById("chat-explain-result-btn");
  if (btn) btn.disabled = true;

  const spinner = _chatShowSpinner();
  try {
    const payload = {
      user_prefs:     { rent: currentPreferences.rent, bedrooms: currentPreferences.bedrooms, bathrooms: currentPreferences.bathrooms },
      priority_order: currentPreferences.priority_order || [],
      ols_coef:       _currentOlsCoef,
      neighborhood:   currentPreferences.neighborhood_name || "",
      concern:        currentPreferences.concern || "",
    };
    const res  = await fetch(`${API_BASE}/explain_result`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (spinner) spinner.remove();
    _chatAppend("bot", data.error ? `Error: ${data.error}` : data.explanation);
  } catch (_) {
    if (spinner) spinner.remove();
    _chatAppend("bot", "Connection error.");
  }
  // Remove button — one-time use
  if (btn) btn.remove();
}

//--------------------------------------------------------------------
// Chat send → filter or sort
//--------------------------------------------------------------------
async function _onChatSend(msg) {
  if (!_currentGeojson) return;

  _chatHistory.push({ role: "user", content: msg });
  _chatAppend("user", msg);

  const spinner = _chatShowSpinner();
  const sendBtn = document.getElementById("chat-send-btn");
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res  = await fetch(`${API_BASE}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history: _chatHistory.slice(0, -1) }),
    });
    const data = await res.json();
    if (spinner) spinner.remove();

    if (data.error) {
      _chatAppend("bot", `Error: ${data.error}`);
    } else {
      const result = data.result;
      _chatHistory.push({ role: "assistant", content: JSON.stringify(result) });
      _applyChatResult(result);
    }
  } catch (_) {
    if (spinner) spinner.remove();
    _chatAppend("bot", "Connection error.");
  }
  if (sendBtn) sendBtn.disabled = false;
}

function _applyChatResult(result) {
  if (!result) return;

  // Guidance/clarification message — no data operation
  if (!result.filters && !result.sort) {
    _chatAppend("bot", result.message || "I'm not sure how to help with that. Try asking to filter by rent, size, noise level, elevator, or subway distance.");
    return;
  }

  let workingGeo = _currentGeojson;

  // Apply filters
  if (result.filters && result.filters.length > 0) {
    const logic = (result.logic || "AND").toUpperCase();
    workingGeo = {
      type: "FeatureCollection",
      features: workingGeo.features.filter(f => {
        const p = f.properties;
        const tests = result.filters.map(({ column, op, value }) => {
          let pv = p[column];
          // Handle noise_level_ord alias
          if (column === "noise_level_ord" && pv == null) {
            const NL = { "very low": 0, "low": 1, "medium": 2, "high": 3, "very high": 4 };
            pv = NL[String(p.noise_level || "").toLowerCase().trim()] ?? null;
          }
          if (pv == null) return false;
          const nv = Number(pv), nval = Number(value);
          switch (op) {
            case "<=": return nv <= nval;
            case ">=": return nv >= nval;
            case "<":  return nv < nval;
            case ">":  return nv > nval;
            case "==": return String(pv) === String(value);
            case "!=": return String(pv) !== String(value);
            default:   return true;
          }
        });
        return logic === "OR" ? tests.some(Boolean) : tests.every(Boolean);
      }),
    };
    if (workingGeo.features.length === 0) {
      _chatAppend("bot", "No properties match those filters. Try relaxing your criteria.");
      return;
    }
  }

  // Apply sort
  if (result.sort && result.sort.length > 0) {
    workingGeo = {
      type: "FeatureCollection",
      features: [...workingGeo.features].sort((a, b) => {
        for (const { by, order } of result.sort) {
          const va = Number(a.properties[by]) || 0;
          const vb = Number(b.properties[by]) || 0;
          const diff = order === "desc" ? vb - va : va - vb;
          if (diff !== 0) return diff;
        }
        return 0;
      }),
    };
  }

  // Always show the LLM's explanation message (with count appended)
  const n = workingGeo.features.length;
  const llmMsg = result.message || "";
  _chatAppend("bot", llmMsg ? `${llmMsg} (${n.toLocaleString()} properties shown)` : `Showing ${n.toLocaleString()} properties.`);

  // Update map and listing — reset to default score view
  _activeGeojson = workingGeo;
  if (typeof window.updateRecommendationData === "function") {
    window.updateRecommendationData(workingGeo);
  }
  if (typeof window.initCharts === "function") {
    window.initCharts(workingGeo);
  }
  if (typeof window.updateChoroplethMode === "function") {
    window.updateChoroplethMode("score");
  }

  const listingWrap = document.getElementById("top10-listing-wrap");
  if (listingWrap) _renderTop10Cards(listingWrap, workingGeo);

  // Show reset button
  const resetBtn = document.getElementById("chat-reset-filter-btn");
  if (resetBtn) resetBtn.style.display = "";
}

function _onResetChatFilter() {
  if (!_currentGeojson) return;
  _activeGeojson = _currentGeojson;
  _chatHistory   = [];

  if (typeof window.updateRecommendationData === "function") {
    window.updateRecommendationData(_currentGeojson);
  }
  if (typeof window.initCharts === "function") {
    window.initCharts(_currentGeojson);
  }

  const listingWrap = document.getElementById("top10-listing-wrap");
  if (listingWrap) _renderTop10Cards(listingWrap, _currentGeojson);

  const log = document.getElementById("chat-log");
  if (log) log.innerHTML = "";
  const resetBtn = document.getElementById("chat-reset-filter-btn");
  if (resetBtn) resetBtn.style.display = "none";

  _chatAppend("bot", "Results reset to original recommendations.");
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
    _currentGeojson  = data.geojson;
    _activeGeojson   = data.geojson;
    _currentOlsCoef  = data.ols_coef || {};
    _chatHistory     = [];

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

    _showResultsUI(data.geojson);

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
    window.currentPreferences = null;
    _currentGeojson   = null;
    _activeGeojson    = null;
    _currentOlsCoef   = null;
    _chatHistory      = [];

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
