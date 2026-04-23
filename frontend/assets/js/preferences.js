// preferences.js
// Popup modal to collect rent, bedroom, bathroom preferences, and priority order.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

const RENT_MIN      = 1500;
const RENT_MAX      = 10000;
const RENT_STEP     = 50;
const RENT_DEFAULT  = 3000;

const ROOM_MIN          = 0;
const ROOM_MAX          = 10;
const BEDROOMS_DEFAULT  = 1;
const BATHROOMS_DEFAULT = 1;

// The three priority keys, in display order
const PRIORITY_KEYS = ["rent", "location", "sqft"];

//--------------------------------------------------------------------

(function () {
  // ---- Build overlay ----
  const overlay = document.createElement("div");
  overlay.id = "pref-overlay";

  const modal = document.createElement("div");
  modal.id = "pref-modal";

  modal.innerHTML = `
    <button id="pref-invert" title="Invert colors">&#9680;</button>
    <div id="pref-title">
      <img id="pref-logo" src="assets/images/explorentory_dark.png" alt="Explorentory" style="width:100%;height:auto;display:block;">
    </div>
    <div id="pref-subtitle">Find your perfect NYC rental</div>

    <div class="pref-field">
      <label class="pref-label">Monthly Rent</label>
      <div class="pref-rent-display">$<span id="pref-rent-value">${RENT_DEFAULT.toLocaleString()}</span></div>
      <input type="range" id="pref-rent" min="${RENT_MIN}" max="${RENT_MAX}" step="${RENT_STEP}" value="${RENT_DEFAULT}">
      <div class="pref-rent-range"><span>$${RENT_MIN.toLocaleString()}</span><span>$${RENT_MAX.toLocaleString()}</span></div>
    </div>

    <div class="pref-field-row">
      <div class="pref-field">
        <label class="pref-label">Bedrooms</label>
        <input type="number" class="pref-number" id="pref-bedrooms" min="${ROOM_MIN}" max="${ROOM_MAX}" value="${BEDROOMS_DEFAULT}">
      </div>
      <div class="pref-field">
        <label class="pref-label">Bathrooms</label>
        <input type="number" class="pref-number" id="pref-bathrooms" min="${ROOM_MIN}" max="${ROOM_MAX}" value="${BATHROOMS_DEFAULT}">
      </div>
    </div>

    <div class="pref-field">
      <label class="pref-label">What matters most? &mdash; click in order of preference</label>
      <div id="pref-priority-row">
        <div class="pref-priority-card" data-key="rent">
          <div class="pref-priority-rank"></div>
          <div class="pref-priority-name">Rent</div>
        </div>
        <div class="pref-priority-card" data-key="location">
          <div class="pref-priority-rank"></div>
          <div class="pref-priority-name">Location</div>
        </div>
        <div class="pref-priority-card" data-key="sqft">
          <div class="pref-priority-rank"></div>
          <div class="pref-priority-name">Sq. Footage</div>
        </div>
      </div>
      <div id="pref-priority-hint">Click <span class="pref-rank-badge">1</span> → <span class="pref-rank-badge">2</span> → <span class="pref-rank-badge">3</span> &nbsp;·&nbsp; click again to unrank</div>
    </div>

    <div class="pref-field">
      <label class="pref-label" for="pref-concern">Any other concerns?</label>
      <textarea id="pref-concern" placeholder="Describe your concerns for a new place in NYC — commute, noise, green space proximity, etc."></textarea>
    </div>

    <button id="pref-submit" disabled>Find Properties</button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ---- Invert button (mirrors the main color-invert button) ----
  function _updateLogo() {
    const logo = document.getElementById("pref-logo");
    if (logo) logo.src = document.body.classList.contains("bright")
      ? "assets/images/explorentory_bright.png"
      : "assets/images/explorentory_dark.png";
  }

  document.getElementById("pref-invert").addEventListener("click", () => {
    document.body.classList.toggle("bright");
    _updateLogo();
    if (typeof window.toggleMapStyle === "function") window.toggleMapStyle();
    if (typeof window.redrawCharts   === "function") window.redrawCharts();
  });

  // Also sync logo when main invert button is clicked
  const _mainInvert = document.getElementById("color-invert");
  if (_mainInvert) _mainInvert.addEventListener("click", _updateLogo);

  // ---- Live rent display ----
  const rentSlider = document.getElementById("pref-rent");
  const rentValue  = document.getElementById("pref-rent-value");

  rentSlider.addEventListener("input", () => {
    rentValue.textContent = Number(rentSlider.value).toLocaleString();
  });

  // ---- Priority click-in-order ----
  // _selection is an ordered array of keys: first click = rank 1 (highest priority).
  let _selection = [];

  const priorityRow = document.getElementById("pref-priority-row");
  const submitBtn   = document.getElementById("pref-submit");

  function _refreshPriorityCards() {
    priorityRow.querySelectorAll(".pref-priority-card").forEach(card => {
      const key  = card.dataset.key;
      const rank = _selection.indexOf(key);  // 0-based, -1 = not ranked
      const rankEl = card.querySelector(".pref-priority-rank");

      if (rank === -1) {
        rankEl.textContent = "";
        card.classList.remove("selected");
      } else {
        rankEl.textContent = rank + 1;
        card.classList.add("selected");
      }
    });

    // Enable submit only when all three are ranked
    submitBtn.disabled = _selection.length < PRIORITY_KEYS.length;
  }

  priorityRow.querySelectorAll(".pref-priority-card").forEach(card => {
    card.addEventListener("click", () => {
      const key = card.dataset.key;
      const existingRank = _selection.indexOf(key);

      if (existingRank !== -1) {
        // Clicking an already-ranked card unranks it and everything after it
        _selection = _selection.slice(0, existingRank);
      } else if (_selection.length < PRIORITY_KEYS.length) {
        // Add to the end of the current ranking
        _selection.push(key);
      }

      _refreshPriorityCards();
    });
  });

  _refreshPriorityCards();

  // ---- Submit ----
  submitBtn.addEventListener("click", () => {
    if (_selection.length < PRIORITY_KEYS.length) return;

    const rent      = Number(rentSlider.value);
    const bedrooms  = Math.max(ROOM_MIN, Number(document.getElementById("pref-bedrooms").value));
    const bathrooms = Math.max(ROOM_MIN, Number(document.getElementById("pref-bathrooms").value));
    const concern   = (document.getElementById("pref-concern").value || "").trim();

    overlay.style.display = "none";

    if (typeof window.onPreferencesSubmit === "function") {
      window.onPreferencesSubmit({ rent, bedrooms, bathrooms, priority_order: _selection, concern });
    }
  });

  // ---- Public API ----
  window.showPreferencesModal = function () {
    _selection = [];
    _refreshPriorityCards();
    const concernEl = document.getElementById("pref-concern");
    if (concernEl) concernEl.value = "";
    overlay.style.display = "flex";
  };
})();
