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
let _chatLoadedProps        = [];     // properties dragged into chat context (max 3)
let _lastBotBubble          = null;   // last bot message element (gets "Return to this state" when next query runs)

// Dummy real estate agent directory by borough (for Contact Agent feature)
const _DUMMY_AGENTS = {
  1: { name: "Manhattan Premier Realty",    phone: "+1 212-555-0191" },
  2: { name: "Bronx Home Advisors",         phone: "+1 929-555-0182" },
  3: { name: "Brooklyn Property Group",     phone: "+1 718-555-0173" },
  4: { name: "Queens Real Estate Partners", phone: "+1 718-555-0164" },
  5: { name: "Staten Island Realty Co.",    phone: "+1 718-555-0155" },
};
window.getAgentInfo = function (borocode) {
  return _DUMMY_AGENTS[Number(borocode)] || { name: "NYC Home Advisors", phone: "+1 212-555-0100" };
};

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
  _expandChatPanel();

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

  // Chat panel (controls are appended inside chat-panel after it is built)
  const chatPanel = _buildChatPanel();
  outputBox.appendChild(chatPanel);
  _buildChatControls();

  // Default welcome message — treated as the first "state" bubble so it can get a "Return to this state" button later
  const _welcomeBubble = _chatAppend("bot", "Your recommendations are ready! Drag any property card or map pin here to ask questions about it, or type below to filter by rent, size, neighborhood, noise level, subway distance, and more.");
  if (_welcomeBubble) {
    _welcomeBubble._chatSnapshot = _activeGeojson;
    _lastBotBubble = _welcomeBubble;
  }

  // 2-column layout when sidebar is wide enough
  _attachListingResizeObserver(listingWrap);

  // Pin chat panel at a default height; listing wrap fills remaining space via flex: 1
  requestAnimationFrame(() => {
    const outputH   = outputBox.offsetHeight;
    const chatInitH = Math.max(140, Math.round(outputH * 0.3));
    chatPanel.style.flex   = "none";
    chatPanel.style.height = chatInitH + "px";
  });
}

function _attachListingChatHandle(handle, listingWrap) {
  let resizing = false, startY = 0, startChatH = 0;
  handle.addEventListener("mousedown", (e) => {
    resizing   = true;
    startY     = e.clientY;
    const chatPanel = document.getElementById("chat-panel");
    startChatH = chatPanel ? chatPanel.offsetHeight : 0;
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
    const chatPanel = document.getElementById("chat-panel");
    const chatMinH  = 100; // controls (~80px) + minimum log height
    const maxChatH  = outputH - handleH - 60; // leave at least 60px for listing
    // Dragging handle down shrinks chat (delta > 0 → chat smaller)
    const newChatH  = Math.max(chatMinH, Math.min(maxChatH, startChatH - delta));
    if (chatPanel) {
      chatPanel.style.flex   = "none";
      chatPanel.style.height = newChatH + "px";
    }
    // listing wrap auto-fills remaining space — no explicit height needed
    listingWrap.style.flex   = "1 1 0";
    listingWrap.style.height = "";
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
  hdr.textContent = "TOP 10 RECOMMENDATIONS";
  container.appendChild(hdr);

  features.forEach((f, idx) => {
    const p = f.properties;

    const rent   = p.rent_knn      != null ? `$${Math.round(p.rent_knn).toLocaleString()}/mo` : "—";
    const sqft   = p.sqft          != null ? `${Math.round(p.sqft).toLocaleString()} sqft`    : null;
    const bd     = Number(p.bedroomnum)    || 0;
    const ba     = Number(p.bathroomnum)   || 0;
    const lr     = Number(p.livingroomnum) || 0;
    const beds   = p.bedroomnum    != null ? `${bd} Bedroom${bd !== 1 ? "s" : ""}`            : null;
    const baths  = p.bathroomnum   != null ? `${ba} Bathroom${ba !== 1 ? "s" : ""}`           : null;
    const lvroom = lr > 0                  ? `${lr} Living Room${lr !== 1 ? "s" : ""}`        : "Studio";
    const hood   = p.small_n       || "—";
    const rightTags = [sqft, beds, baths, lvroom].filter(Boolean);

    const card = document.createElement("div");
    card.className  = "top10-card";
    card.draggable  = true;
    card.innerHTML = `
      <div class="top10-card-left">
        <div class="top10-card-hood">#${idx + 1}&nbsp;${hood}</div>
        <div class="top10-card-rent">${rent}</div>
      </div>
      <div class="top10-card-right">${rightTags.map(t => `<span class="top10-tag">${t}</span>`).join("")}</div>`;

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify(p));
      e.dataTransfer.effectAllowed = "copy";
    });

    card.addEventListener("click", () => {
      document.querySelectorAll(".top10-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      if (typeof window.onPropertyClick        === "function") window.onPropertyClick(p);
      if (typeof window.flyToProperty          === "function") window.flyToProperty(p);
      if (typeof window.highlightPropertyOnMap === "function") window.highlightPropertyOnMap(f);
    });

    const cardLeft = card.querySelector(".top10-card-left");

    const explainBtn = document.createElement("button");
    explainBtn.className   = "explain-btn";
    explainBtn.textContent = "Explain";
    explainBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _callExplain(p, cardLeft);
    });
    cardLeft.appendChild(explainBtn);

    const contactBtn = document.createElement("button");
    contactBtn.className   = "contact-agent-btn";
    contactBtn.textContent = "Contact Agent";
    const contactInfo = document.createElement("div");
    contactInfo.className = "contact-agent-info";
    const agent = window.getAgentInfo(p.borocode);
    contactInfo.textContent = `Contact Real Estate Agent (${agent.name}) ${agent.phone}`;
    contactInfo.hidden = true;
    contactBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      contactInfo.hidden = !contactInfo.hidden;
      contactBtn.textContent = contactInfo.hidden ? "Contact Agent" : "Hide Agent";
    });
    cardLeft.appendChild(contactBtn);
    cardLeft.appendChild(contactInfo);

    container.appendChild(card);
  });
}

//--------------------------------------------------------------------
// Chat panel builder
//--------------------------------------------------------------------
function _buildChatPanel() {
  const panel = document.createElement("div");
  panel.id = "chat-panel";

  // Message log (prop bubbles appear inline here)
  const log = document.createElement("div");
  log.id = "chat-log";
  panel.appendChild(log);

  // Drop zone: accept dragged property cards and map pins
  panel.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    panel.classList.add("drag-over");
  });
  panel.addEventListener("dragleave", (e) => {
    if (!panel.contains(e.relatedTarget)) panel.classList.remove("drag-over");
  });
  panel.addEventListener("drop", (e) => {
    e.preventDefault();
    panel.classList.remove("drag-over");
    try {
      const prop = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (prop && typeof prop === "object") window.addPropToChat(prop);
    } catch (_) {}
  });

  return panel;
}

//--------------------------------------------------------------------
// Property context helpers — bubbles appear inline in chat-log
//--------------------------------------------------------------------
window.addPropToChat = function (prop) {
  const MAX = 3;
  if (_chatLoadedProps.length >= MAX) {
    _chatAppend("bot", "Max 3 properties — remove one first.");
    return;
  }
  const isDupe = _chatLoadedProps.some(
    p => p.centroid_lon === prop.centroid_lon && p.centroid_lat === prop.centroid_lat
  );
  if (isDupe) return;

  _chatLoadedProps.push(prop);

  const log = document.getElementById("chat-log");
  if (!log) return;

  const hood = prop.small_n || prop.large_n || "Property";
  const rent = prop.rent_knn != null ? ` · $${Math.round(prop.rent_knn).toLocaleString()}/mo` : "";

  const bubble = document.createElement("div");
  bubble.className          = "chat-bubble chat-bubble-prop chat-bubble-prop-staged";
  bubble.dataset.propBubble = "staged";

  const label = document.createElement("span");
  label.textContent = `▣ ${hood}${rent}`;

  const rm = document.createElement("button");
  rm.className   = "chat-bubble-prop-remove";
  rm.textContent = "×";
  rm.title       = "Remove from chat";
  rm.addEventListener("click", () => {
    const idx = _chatLoadedProps.findIndex(
      p => p.centroid_lon === prop.centroid_lon && p.centroid_lat === prop.centroid_lat
    );
    if (idx !== -1) _chatLoadedProps.splice(idx, 1);
    bubble.remove();
  });

  bubble.appendChild(label);
  bubble.appendChild(rm);
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
};

function _buildChatControls() {
  // Remove any existing controls
  const existing = document.getElementById("chat-controls");
  if (existing) existing.remove();

  const msgEl = document.getElementById("message");
  if (!msgEl) return;

  const ctrl = document.createElement("div");
  ctrl.id = "chat-controls";

  // "Explain Result" button row
  const explainRow = document.createElement("div");
  explainRow.id = "chat-explain-row";

  const explainResultBtn = document.createElement("button");
  explainResultBtn.id          = "chat-explain-result-btn";
  explainResultBtn.textContent = "Explain Result";
  explainResultBtn.addEventListener("click", _onExplainResult);
  explainRow.appendChild(explainResultBtn);

  const resetFilterBtn = document.createElement("button");
  resetFilterBtn.id            = "chat-reset-filter-btn";
  resetFilterBtn.textContent   = "Reset";
  resetFilterBtn.title         = "Reset to original results";
  resetFilterBtn.style.display = "none";
  resetFilterBtn.addEventListener("click", _onResetChatFilter);
  explainRow.appendChild(resetFilterBtn);
  ctrl.appendChild(explainRow);

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
  ctrl.appendChild(inputRow);

  const chatPanel = document.getElementById("chat-panel");
  if (chatPanel) chatPanel.appendChild(ctrl);
}

//--------------------------------------------------------------------
// Chat log helpers
//--------------------------------------------------------------------
function _chatAppend(role, text) {
  const log = document.getElementById("chat-log");
  if (!log) return null;
  const el = document.createElement("div");
  el.className = `chat-bubble chat-bubble-${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
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
// Chat panel expand — smoothly grows chat to 50% of output area on interaction
//--------------------------------------------------------------------
function _expandChatPanel() {
  const chatPanel = document.getElementById("chat-panel");
  if (!chatPanel || !outputBox) return;
  const targetH  = Math.round(outputBox.offsetHeight * 0.5);
  const currentH = chatPanel.offsetHeight;
  if (currentH < targetH) {
    chatPanel.style.height = targetH + "px";
    const listingWrap = document.getElementById("top10-listing-wrap");
    if (listingWrap) { listingWrap.style.flex = "1 1 0"; listingWrap.style.height = ""; }
  }
}

//--------------------------------------------------------------------
// Explain Result
//--------------------------------------------------------------------
function _buildResultSummary(geojson) {
  const BORO = { 1: "Manhattan", 2: "Bronx", 3: "Brooklyn", 4: "Queens", 5: "Staten Island" };
  const byBoro = {}, byHood = {};
  const scores = [], rents = [];

  for (const f of geojson.features) {
    const p     = f.properties;
    const score = Number(p.final_score) || 0;
    const rent  = Number(p.rent_knn)    || 0;
    const boro  = Number(p.borocode)    || 0;
    const hood  = p.large_n || "unknown";

    scores.push(score);
    if (rent > 0) rents.push(rent);

    if (!byBoro[boro]) byBoro[boro] = { name: BORO[boro] || `Boro ${boro}`, count: 0, scoreSum: 0, rentSum: 0 };
    byBoro[boro].count++; byBoro[boro].scoreSum += score; byBoro[boro].rentSum += rent;

    if (!byHood[hood]) byHood[hood] = { count: 0, scoreSum: 0 };
    byHood[hood].count++; byHood[hood].scoreSum += score;
  }

  const boroList = Object.values(byBoro).map(d => ({
    borough:   d.name,
    count:     d.count,
    avg_score: +(d.scoreSum / d.count).toFixed(3),
    avg_rent:  Math.round(d.rentSum / d.count),
  })).sort((a, b) => b.avg_score - a.avg_score);

  const hoodList = Object.entries(byHood)
    .filter(([, d]) => d.count >= 3)
    .map(([name, d]) => ({ neighborhood: name, count: d.count, avg_score: +(d.scoreSum / d.count).toFixed(3) }))
    .sort((a, b) => b.avg_score - a.avg_score);

  const avg     = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const minOf   = arr => arr.length ? Math.min(...arr) : 0;
  const maxOf   = arr => arr.length ? Math.max(...arr) : 0;
  return {
    total_properties: geojson.features.length,
    score: { min: +minOf(scores).toFixed(3), max: +maxOf(scores).toFixed(3), avg: +avg(scores).toFixed(3) },
    rent:  { min: Math.round(minOf(rents)),  max: Math.round(maxOf(rents)),  avg: Math.round(avg(rents)) },
    by_borough: boroList,
    top_neighborhoods:    hoodList.slice(0, 6),
    bottom_neighborhoods: hoodList.slice(-6).reverse(),
  };
}

async function _onExplainResult() {
  if (!currentPreferences || !_currentOlsCoef || !_currentGeojson) return;
  const btn = document.getElementById("chat-explain-result-btn");
  if (btn) btn.disabled = true;
  _expandChatPanel();

  const spinner = _chatShowSpinner();
  try {
    const payload = {
      user_prefs:     { rent: currentPreferences.rent, bedrooms: currentPreferences.bedrooms, bathrooms: currentPreferences.bathrooms },
      priority_order: currentPreferences.priority_order || [],
      ols_coef:       _currentOlsCoef,
      neighborhood:   currentPreferences.neighborhood_name || "",
      concern:        currentPreferences.concern || "",
      result_summary: _buildResultSummary(_currentGeojson),
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
  _expandChatPanel();

  // Capture and commit staged prop bubbles before the user message
  const propsToSend = [..._chatLoadedProps];
  _chatLoadedProps  = [];
  document.querySelectorAll(".chat-bubble-prop-staged").forEach(el => {
    el.classList.remove("chat-bubble-prop-staged");
    const rmBtn = el.querySelector(".chat-bubble-prop-remove");
    if (rmBtn) rmBtn.remove();
  });

  _chatHistory.push({ role: "user", content: msg });
  _chatAppend("user", msg);

  const spinner = _chatShowSpinner();
  const sendBtn = document.getElementById("chat-send-btn");
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res  = await fetch(`${API_BASE}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history: _chatHistory.slice(0, -1), properties: propsToSend }),
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

// Add a "Return to this state" button to a bubble. Safe to call multiple times (deduplicates).
// On click: restores the bubble's own snapshot, demotes _lastBotBubble back to non-current,
// and promotes this bubble as the new current (removes its own button).
function _addRevertButton(bubble) {
  if (!bubble || !bubble._chatSnapshot) return;
  if (bubble.querySelector(".chat-revert-btn")) return;
  const snapshot = bubble._chatSnapshot;
  const revertBtn = document.createElement("button");
  revertBtn.className   = "chat-revert-btn";
  revertBtn.textContent = "↩ Return to this state";
  revertBtn.addEventListener("click", () => {
    _activeGeojson = snapshot;
    if (typeof window.updateRecommendationData === "function") window.updateRecommendationData(snapshot);
    if (typeof window.initCharts             === "function") window.initCharts(snapshot);
    if (typeof window.updateChoroplethMode   === "function") window.updateChoroplethMode("score");
    const lw = document.getElementById("top10-listing-wrap");
    if (lw) _renderTop10Cards(lw, snapshot);
    // This bubble is now current — remove its button
    revertBtn.remove();
    // Previous current bubble is no longer current — give it a button
    if (_lastBotBubble && _lastBotBubble !== bubble) {
      _addRevertButton(_lastBotBubble);
    }
    _lastBotBubble = bubble;
  });
  bubble.appendChild(revertBtn);
}

function _applyChatResult(result) {
  if (!result) return;

  // EXPLAIN — answer question without changing the displayed data
  if (result.explain) {
    _chatAppend("bot", result.message || "I'm not sure how to answer that.");
    return;
  }

  // CONTACT (final choice) — show agent info without changing the displayed data
  if (result.contact) {
    _chatAppend("bot", result.message || "Ready to connect you with a real estate agent!");
    return;
  }

  // UNCLEAR / guidance — no data operation
  if (!result.filters && !result.sort) {
    _chatAppend("bot", result.message || "I'm not sure how to help with that. Try asking to filter by rent, size, noise level, elevator, or subway distance.");
    return;
  }

  let workingGeo = _activeGeojson;

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

  // LLM signals a count cap — numeric N for explicit "top N" requests, true for ambiguous similarity
  if (result.limit) {
    const limitN = (typeof result.limit === "number")
      ? Math.max(1, Math.round(result.limit))
      : Math.max(10, Math.round(workingGeo.features.length * 0.2));
    if (workingGeo.features.length > limitN) {
      workingGeo = {
        type: "FeatureCollection",
        features: [...workingGeo.features]
          .sort((a, b) => (Number(b.properties.final_score) || 0) - (Number(a.properties.final_score) || 0))
          .slice(0, limitN),
      };
    }
  }

  // Demote the current state bubble — it is no longer current, so give it a "Return to this state" button
  _addRevertButton(_lastBotBubble);

  // Create new bot bubble and record its result snapshot — no button yet (it IS the current state)
  const n = workingGeo.features.length;
  const llmMsg = result.message || "";
  const botBubble = _chatAppend("bot", llmMsg ? `${llmMsg} (${n.toLocaleString()} properties shown)` : `Showing ${n.toLocaleString()} properties.`);
  if (botBubble) botBubble._chatSnapshot = workingGeo;
  _lastBotBubble = botBubble;

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
  _activeGeojson  = _currentGeojson;
  _chatHistory    = [];
  _lastBotBubble  = null;

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

    document.body.classList.remove("rating-stage");
    if (typeof window.stopOrbitCamera === "function") window.stopOrbitCamera();
    _chatHistory     = [];
    _chatLoadedProps = [];
    _lastBotBubble   = null;

    if (typeof clearAllSources === "function") clearAllSources();
    if (typeof window.clearCharts === "function") window.clearCharts();
    hideMapLoading();
    setTimeout(() => { if (window.map) window.map.resize(); }, 0);
    const chatCtrl = document.getElementById("chat-controls");
    if (chatCtrl) chatCtrl.remove();

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
