// rating.js
// Shows all sample properties as rating cards so the user can rate each one
// and easily go back to change a score. Calls window.showSinglePropertyOnMap()
// for the active property and window.onRatingsSubmit() on submit.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

const RATING_DEFAULT = 5;
const RATING_MIN     = 0;
const RATING_MAX     = 10;

//--------------------------------------------------------------------

let _properties = [];
let _ratings    = [];
let _currentIdx = 0;

//--------------------------------------------------------------------
// showRatingPanel  – entry point called from main.js
//--------------------------------------------------------------------
function showRatingPanel(properties) {
  _properties = properties;
  _ratings    = properties.map(() => RATING_DEFAULT);
  _currentIdx = 0;

  // Ensure neighborhood layer is gone before survey starts
  if (typeof window.clearNeighborhoodLayer === "function") {
    window.clearNeighborhoodLayer();
  }

  _buildPanel();
}

//--------------------------------------------------------------------
// Build the full card-list panel
//--------------------------------------------------------------------
function _buildPanel() {
  const outputBox = document.getElementById("output-message");
  if (!outputBox) return;
  outputBox.innerHTML = "";

  const panel = document.createElement("div");
  panel.id = "rating-panel";

  // Header
  const progress = document.createElement("div");
  progress.id        = "rating-progress";
  progress.textContent = `Rate below ${_properties.length} properties in scale of 0 – 10`;
  panel.appendChild(progress);

  // Scrollable card list
  const list = document.createElement("div");
  list.id = "rating-list";

  _properties.forEach((prop, idx) => {
    const card = _buildPropertyCard(prop, idx);
    list.appendChild(card);
  });
  panel.appendChild(list);

  // Submit button
  const submitBtn = document.createElement("button");
  submitBtn.id          = "rating-submit";
  submitBtn.textContent = "Get Recommendations \u2192";
  submitBtn.addEventListener("click", _onSubmit);
  panel.appendChild(submitBtn);

  outputBox.appendChild(panel);

  // Show all 10 property geometries on the map
  if (typeof window.showAllSurveyPropertiesOnMap === "function") {
    window.showAllSurveyPropertiesOnMap(_properties);
  }

  // Place all survey pins on the map (active = index 0)
  if (typeof window.showSurveyPinsOnMap === "function") {
    window.showSurveyPinsOnMap(_properties, 0);
  }

  // Activate first card (fits map to first property)
  _setActiveCard(0, false);
}

//--------------------------------------------------------------------
// Build a single property rating card
//--------------------------------------------------------------------
function _buildPropertyCard(prop, idx) {
  const card = document.createElement("div");
  card.className  = "rating-property-card";
  card.dataset.idx = idx;

  const rent  = prop.rent_knn    != null ? `$${Math.round(prop.rent_knn).toLocaleString()}/mo` : null;
  const sqft  = prop.sqft        != null ? `${Math.round(prop.sqft)} sqft` : null;
  const beds  = prop.bedroomnum  != null ? `${prop.bedroomnum} bd`  : null;
  const baths = prop.bathroomnum != null ? `${prop.bathroomnum} ba` : null;
  const chips = [rent, sqft, beds, baths].filter(Boolean);

  card.innerHTML = `
    <div class="rating-card-header">
      <span class="rating-card-num">#${idx + 1}</span>
      <span class="rating-card-hood">${prop.small_n || "NYC"}</span>
    </div>
    <div class="rating-card-chips">${
      chips.map(c => `<span>${c}</span>`).join("")
    }</div>
    <div class="rating-card-score-row">
      <label class="rating-card-score-label">Score</label>
      <input type="number" class="rating-card-input"
             min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="${RATING_DEFAULT}">
      <span class="rating-card-max">/ ${RATING_MAX}</span>
    </div>`;

  // Clicking the card body (not the input) makes it active
  card.addEventListener("click", (e) => {
    if (e.target.tagName === "INPUT") return;
    _setActiveCard(idx, true);
  });

  // Score input keeps _ratings in sync
  card.querySelector(".rating-card-input").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    _ratings[idx] = Math.min(RATING_MAX, Math.max(RATING_MIN, isNaN(v) ? RATING_DEFAULT : v));
  });

  return card;
}

//--------------------------------------------------------------------
// Set the active (focused) card and show it on the map
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

  // Dim all pins, brighten the active one
  if (typeof window.updateActiveSurveyPin === "function") {
    window.updateActiveSurveyPin(idx);
  }

  // Fly map to this property
  if (typeof window.flyToProperty === "function") {
    window.flyToProperty(_properties[idx]);
  }
}

//--------------------------------------------------------------------
// Submit — collect all ratings and call onRatingsSubmit
//--------------------------------------------------------------------
function _onSubmit() {
  // Sync any live input values into _ratings before sending
  document.querySelectorAll(".rating-card-input").forEach((input, idx) => {
    const v = Number(input.value);
    _ratings[idx] = Math.min(RATING_MAX, Math.max(RATING_MIN, isNaN(v) ? RATING_DEFAULT : v));
  });

  const payload = _properties.map((prop, i) => ({
    features: prop,
    rating:   _ratings[i],
  }));

  if (typeof window.onRatingsSubmit === "function") {
    window.onRatingsSubmit(payload);
  }
}

window.showRatingPanel = showRatingPanel;
