// rating.js
// Two-column rating UI: left = compact card list, right = full detail card.

const RATING_DEFAULT = 5;
const RATING_MIN     = 0;
const RATING_MAX     = 10;

let _properties = [];
let _ratings    = [];
let _currentIdx = 0;

//--------------------------------------------------------------------
// Entry point
//--------------------------------------------------------------------
function showRatingPanel(properties) {
  _properties = properties;
  _ratings    = properties.map(() => RATING_DEFAULT);
  _currentIdx = 0;

  if (typeof window.clearNeighborhoodLayer === "function") {
    window.clearNeighborhoodLayer();
  }

  document.body.classList.add("rating-stage");
  setTimeout(() => { if (window.map) window.map.resize(); }, 0);

  _buildPanel();
}

//--------------------------------------------------------------------
// Build panel
//--------------------------------------------------------------------
function _buildPanel() {
  const outputBox = document.getElementById("output-message");
  if (!outputBox) return;
  outputBox.innerHTML = "";

  const panel = document.createElement("div");
  panel.id = "rating-panel";

  // Header
  const progress = document.createElement("div");
  progress.id          = "rating-progress";
  progress.textContent = `Rate ${_properties.length} properties — scale 0 to ${RATING_MAX}`;
  panel.appendChild(progress);

  // Two-column body
  const body = document.createElement("div");
  body.id = "rating-body";

  // Left column: compact card list
  const leftCol = document.createElement("div");
  leftCol.id = "rating-list-col";

  const list = document.createElement("div");
  list.id = "rating-list";

  _properties.forEach((prop, idx) => {
    list.appendChild(_buildCompactCard(prop, idx));
  });
  leftCol.appendChild(list);
  body.appendChild(leftCol);

  // Right column: detail card
  const rightCol = document.createElement("div");
  rightCol.id = "rating-detail-col";
  rightCol.appendChild(_buildDetailCard(_properties[0], 0));
  body.appendChild(rightCol);

  panel.appendChild(body);

  // Submit
  const submitBtn = document.createElement("button");
  submitBtn.id          = "rating-submit";
  submitBtn.textContent = "Get Recommendations \u2192";
  submitBtn.addEventListener("click", _onSubmit);
  panel.appendChild(submitBtn);

  outputBox.appendChild(panel);

  if (typeof window.showAllSurveyPropertiesOnMap === "function") {
    window.showAllSurveyPropertiesOnMap(_properties);
  }
  if (typeof window.showSurveyPinsOnMap === "function") {
    window.showSurveyPinsOnMap(_properties, 0);
  }

  _setActiveCard(0, false);
}

//--------------------------------------------------------------------
// Compact card (left column) — top10-card layout with borough + rent + score
//--------------------------------------------------------------------
function _buildCompactCard(prop, idx) {
  const card = document.createElement("div");
  card.className   = "rating-property-card";
  card.dataset.idx = idx;

  const borough = prop.large_n || prop.small_n || "—";
  const rent    = prop.rent_knn != null ? `$${Math.round(prop.rent_knn).toLocaleString()}/mo` : "—";
  const sqft    = prop.sqft          != null ? `${Math.round(prop.sqft).toLocaleString()} sqft` : null;
  const lr      = Number(prop.livingroomnum) || 0;
  const bd      = Number(prop.bedroomnum)    || 0;
  const ba      = Number(prop.bathroomnum)   || 0;
  const beds    = prop.bedroomnum   != null ? `${bd} Bedroom${bd !== 1 ? "s" : ""}` : null;
  const baths   = prop.bathroomnum  != null ? `${ba} Bathroom${ba !== 1 ? "s" : ""}` : null;
  const lvroom  = lr > 0 ? `${lr} Living Room${lr !== 1 ? "s" : ""}` : "Studio";
  const rightTags = [sqft, beds, baths, lvroom].filter(Boolean);

  // Left column: number + borough + rent + score input (replacing explain-btn)
  const left = document.createElement("div");
  left.className = "top10-card-left";
  left.innerHTML = `
    <div class="top10-card-hood">#${idx + 1}&nbsp;${borough}</div>
    <div class="top10-card-rent">${rent}</div>`;

  const scoreRow = document.createElement("div");
  scoreRow.className = "rating-card-score-row";
  scoreRow.innerHTML = `<label class="rating-card-score-label">Score</label>
    <input type="number" class="rating-card-input"
           min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="${_ratings[idx]}">
    <span class="rating-card-max">/ ${RATING_MAX}</span>`;
  left.appendChild(scoreRow);
  card.appendChild(left);

  // Right column: property tags (always rendered — lvroom is always "Studio" or N Living Rooms)
  const right = document.createElement("div");
  right.className = "top10-card-right";
  right.innerHTML = rightTags.map(t => `<span class="top10-tag">${t}</span>`).join("");
  card.appendChild(right);

  card.addEventListener("click", () => _setActiveCard(idx, true));

  const input = scoreRow.querySelector(".rating-card-input");
  input.addEventListener("focus", () => _setActiveCard(idx, true));
  input.addEventListener("input", (e) => _syncScore(idx, e.target.value, null));
  input.addEventListener("click", (e) => e.stopPropagation());

  return card;
}

//--------------------------------------------------------------------
// Detail card (right column) — full property info + score
//--------------------------------------------------------------------
function _buildDetailCard(prop, idx) {
  const wrap = document.createElement("div");
  wrap.id = "rating-detail-wrap";

  if (!prop) return wrap;

  const rent      = prop.rent_knn    != null ? `$${Math.round(prop.rent_knn).toLocaleString()}/mo` : "—";
  const sqft      = prop.sqft        != null ? `${Math.round(prop.sqft).toLocaleString()} sqft`    : "—";
  const lr        = Number(prop.livingroomnum) || 0;
  const bd        = Number(prop.bedroomnum)    || 0;
  const ba        = Number(prop.bathroomnum)   || 0;
  const isStudio  = lr === 0;
  const layout    = isStudio
    ? `Studio · ${ba} Bathroom${ba !== 1 ? "s" : ""}`
    : [lr > 0 ? `${lr} Living Room${lr !== 1 ? "s" : ""}` : null,
       `${bd} Bedroom${bd !== 1 ? "s" : ""}`,
       `${ba} Bathroom${ba !== 1 ? "s" : ""}`].filter(Boolean).join(" · ");

  const hasElev   = (prop.elevator === true || prop.elevator === 1 ||
                     prop.elevator === "true" || prop.elevator === "1");
  const noise     = prop.noise_level
    ? String(prop.noise_level).replace(/\b\w/g, c => c.toUpperCase()) : "—";
  const fDist     = v => { const n = Number(v); return (Number.isFinite(n) && n > 0) ? `${Math.round(n).toLocaleString()} ft` : "—"; };
  const fOr       = v => (v != null && v !== "" && v !== 0) ? v : "—";

  const rows = [
    ["Neighborhood",     fOr(prop.small_n)],
    ["Rent",             rent],
    ["Size",             sqft],
    ["Layout",           layout],
    ["Stories",          prop.bld_story  != null ? Math.round(prop.bld_story)  : "—"],
    ["Elevator",         hasElev ? "Yes" : "No"],
    ["Built",            prop.built_year != null ? Math.round(prop.built_year) : "—"],
    ["Subway Distance",  fDist(prop.dist_subway_ft)],
    ["Noise Level",      noise],
    ["Nearest Park",     fOr(prop.nearest_major_park)],
    ["Park Distance",    fDist(prop.dist_major_park_ft)],
    ["Greenspace Dist.", fDist(prop.dist_greenspace_ft)],
    ["Zoning",           fOr(prop.zoning)],
    ["Building Class",   fOr(prop.bldg_class)],
  ];

  wrap.innerHTML = `
    <div class="rating-detail-header">
      <span class="rating-card-num">#${idx + 1}</span>
      <span class="rating-detail-hood">${prop.small_n || "NYC"}</span>
    </div>
    <div class="rating-detail-info">
      <table class="rating-detail-table">${
        rows.map(([label, val]) =>
          `<tr><td class="rating-detail-label">${label}</td><td class="rating-detail-value">${val}</td></tr>`
        ).join("")
      }</table>
    </div>
    <div class="rating-card-score-row" id="rating-detail-score-row">
      <label class="rating-card-score-label">Score</label>
      <input type="number" class="rating-card-input" id="rating-detail-input"
             min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="${_ratings[idx]}">
      <span class="rating-card-max">/ ${RATING_MAX}</span>
    </div>`;

  const detailInput = wrap.querySelector("#rating-detail-input");
  detailInput.addEventListener("input", (e) => _syncScore(idx, e.target.value, "detail"));

  return wrap;
}

//--------------------------------------------------------------------
// Sync score between compact card and detail card
//--------------------------------------------------------------------
function _syncScore(idx, rawVal, source) {
  const v       = Number(rawVal);
  const clamped = Math.min(RATING_MAX, Math.max(RATING_MIN, isNaN(v) ? RATING_DEFAULT : v));
  _ratings[idx] = clamped;

  // Sync to the other input
  if (source !== "detail") {
    const detailInput = document.getElementById("rating-detail-input");
    if (detailInput) detailInput.value = clamped;
  } else {
    const compactInputs = document.querySelectorAll(".rating-card-input");
    if (compactInputs[idx]) compactInputs[idx].value = clamped;
  }
}

//--------------------------------------------------------------------
// Set active card
//--------------------------------------------------------------------
function _setActiveCard(idx, scrollIntoView) {
  _currentIdx = idx;

  document.querySelectorAll(".rating-property-card").forEach((c, i) => {
    c.classList.toggle("active", i === idx);
  });

  if (scrollIntoView) {
    const activeCard = document.querySelectorAll(".rating-property-card")[idx];
    if (activeCard) activeCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // Rebuild detail card for selected property
  const rightCol = document.getElementById("rating-detail-col");
  if (rightCol) {
    rightCol.innerHTML = "";
    rightCol.appendChild(_buildDetailCard(_properties[idx], idx));
  }

  if (typeof window.highlightSurveyPropertyOnMap === "function") {
    window.highlightSurveyPropertyOnMap(idx);
  }
  if (typeof window.updateActiveSurveyPin === "function") {
    window.updateActiveSurveyPin(idx);
  }
  if (typeof window.flyToProperty === "function") {
    window.flyToProperty(_properties[idx]);
  }
}

//--------------------------------------------------------------------
// Submit
//--------------------------------------------------------------------
function _onSubmit() {
  document.querySelectorAll(".rating-property-card").forEach((card, idx) => {
    const input = card.querySelector(".rating-card-input");
    if (input) {
      const v = Number(input.value);
      _ratings[idx] = Math.min(RATING_MAX, Math.max(RATING_MIN, isNaN(v) ? RATING_DEFAULT : v));
    }
  });

  document.body.classList.remove("rating-stage");
  if (typeof window.stopOrbitCamera === "function") window.stopOrbitCamera();
  setTimeout(() => { if (window.map) window.map.resize(); }, 0);

  const payload = _properties.map((prop, i) => ({ features: prop, rating: _ratings[i] }));
  if (typeof window.onRatingsSubmit === "function") window.onRatingsSubmit(payload);
}

window.showRatingPanel     = showRatingPanel;
window.setActiveSurveyCard = function (idx) { _setActiveCard(idx, true); };
