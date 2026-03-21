// rating.js
// Shows 10 sample properties one at a time for user rating.
// Calls window.showSinglePropertyOnMap() for each property and
// window.onRatingsSubmit() when all ratings are collected.

let _properties = [];
let _ratings    = [];   // stores rating value per property index
let _currentIdx = 0;

//--------------------------------------------------------------------
// showRatingPanel  – entry point called from main.js
//--------------------------------------------------------------------
function showRatingPanel(properties) {
  _properties = properties;
  _ratings    = properties.map(() => 5);  // default rating: 5
  _currentIdx = 0;

  _buildPanel();
  _renderCurrent();
}

//--------------------------------------------------------------------
// Build the static panel shell (called once)
//--------------------------------------------------------------------
function _buildPanel() {
  const outputBox = document.getElementById("output-message");
  if (!outputBox) return;
  outputBox.innerHTML = "";

  const panel = document.createElement("div");
  panel.id = "rating-panel";

  panel.innerHTML = `
    <div id="rating-progress"></div>
    <div id="rating-card">
      <div id="rating-neighborhood"></div>
      <div id="rating-details"></div>
      <div id="rating-question">How much do you like this property?</div>
      <div id="rating-input-row">
        <input type="number" id="rating-value" min="0" max="10" step="1" value="5">
        <span class="rating-label">&nbsp;/ 10</span>
      </div>
    </div>
    <div id="rating-nav">
      <button id="rating-prev">&#8592; Previous</button>
      <button id="rating-next">Next &#8594;</button>
    </div>
  `;

  outputBox.appendChild(panel);

  document.getElementById("rating-prev").addEventListener("click", _onPrev);
  document.getElementById("rating-next").addEventListener("click", _onNext);
}

//--------------------------------------------------------------------
// Render the current property into the panel
//--------------------------------------------------------------------
function _renderCurrent() {
  const prop    = _properties[_currentIdx];
  const total   = _properties.length;
  const isFirst = _currentIdx === 0;
  const isLast  = _currentIdx === total - 1;

  // Progress
  document.getElementById("rating-progress").textContent =
    `Property ${_currentIdx + 1} of ${total}`;

  // Neighborhood
  document.getElementById("rating-neighborhood").textContent =
    prop.small_n || "NYC";

  // Detail chips
  const chips = [
    `$${Math.round(prop.rent_knn).toLocaleString()}/mo`,
    prop.sqft ? `${Math.round(prop.sqft)} sqft` : null,
    `${prop.bedroomnum} bed`,
    `${prop.bathroomnum} bath`,
  ].filter(Boolean);

  document.getElementById("rating-details").innerHTML =
    chips.map(c => `<span>${c}</span>`).join("");

  // Rating input — restore saved rating for this property
  document.getElementById("rating-value").value = _ratings[_currentIdx];

  // Navigation buttons
  const prevBtn = document.getElementById("rating-prev");
  const nextBtn = document.getElementById("rating-next");
  prevBtn.disabled = isFirst;
  nextBtn.textContent = isLast ? "Get Recommendations" : "Next \u2192";

  // Show this property's actual geometry on the map
  if (typeof window.showSinglePropertyOnMap === "function") {
    window.showSinglePropertyOnMap(prop);
  }
}

//--------------------------------------------------------------------
// Save current rating then go to previous property
//--------------------------------------------------------------------
function _onPrev() {
  _saveCurrentRating();
  if (_currentIdx > 0) {
    _currentIdx--;
    _renderCurrent();
  }
}

//--------------------------------------------------------------------
// Save current rating then go to next property (or submit)
//--------------------------------------------------------------------
function _onNext() {
  _saveCurrentRating();

  if (_currentIdx < _properties.length - 1) {
    _currentIdx++;
    _renderCurrent();
  } else {
    // All properties rated — submit
    const payload = _properties.map((prop, i) => ({
      features: prop,
      rating:   _ratings[i],
    }));

    if (typeof window.onRatingsSubmit === "function") {
      window.onRatingsSubmit(payload);
    }
  }
}

//--------------------------------------------------------------------
// Save the current input value into _ratings
//--------------------------------------------------------------------
function _saveCurrentRating() {
  const raw    = Number(document.getElementById("rating-value")?.value);
  _ratings[_currentIdx] = Math.min(10, Math.max(0, isNaN(raw) ? 5 : raw));
}

window.showRatingPanel = showRatingPanel;
