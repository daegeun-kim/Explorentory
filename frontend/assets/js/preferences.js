// preferences.js
// Popup modal to collect rent, bedroom, bathroom preferences, and priority order.

(function () {
  // ---- Build overlay ----
  const overlay = document.createElement("div");
  overlay.id = "pref-overlay";

  const modal = document.createElement("div");
  modal.id = "pref-modal";

  modal.innerHTML = `
    <div id="pref-title">Explorentory</div>
    <div id="pref-subtitle">Find your perfect NYC rental</div>

    <div class="pref-field">
      <label class="pref-label">Monthly Rent</label>
      <div class="pref-rent-display">$<span id="pref-rent-value">3,000</span></div>
      <input type="range" id="pref-rent" min="1500" max="10000" step="50" value="3000">
      <div class="pref-rent-range"><span>$1,500</span><span>$10,000</span></div>
    </div>

    <div class="pref-field-row">
      <div class="pref-field">
        <label class="pref-label">Bedrooms</label>
        <input type="number" class="pref-number" id="pref-bedrooms" min="0" max="10" value="1">
      </div>
      <div class="pref-field">
        <label class="pref-label">Bathrooms</label>
        <input type="number" class="pref-number" id="pref-bathrooms" min="0" max="10" value="1">
      </div>
    </div>

    <div class="pref-field">
      <label class="pref-label">What matters most? Click in order of priority</label>
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
      <div id="pref-priority-hint">Tap a card to rank it (1st = most important)</div>
    </div>

    <button id="pref-submit" disabled>Find Properties</button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ---- Live rent display ----
  const rentSlider = document.getElementById("pref-rent");
  const rentValue  = document.getElementById("pref-rent-value");

  rentSlider.addEventListener("input", () => {
    rentValue.textContent = Number(rentSlider.value).toLocaleString();
  });

  // ---- Priority ranking logic ----
  let priorityOrder = []; // e.g. ["rent", "location", "sqft"] in order clicked

  const cards      = modal.querySelectorAll(".pref-priority-card");
  const submitBtn  = document.getElementById("pref-submit");

  function refreshCards() {
    cards.forEach((card) => {
      const key  = card.dataset.key;
      const rank = priorityOrder.indexOf(key); // -1 if not selected
      const rankEl = card.querySelector(".pref-priority-rank");

      if (rank === -1) {
        card.classList.remove("selected");
        rankEl.textContent = "";
      } else {
        card.classList.add("selected");
        rankEl.textContent = rank + 1; // 1-based label
      }
    });

    submitBtn.disabled = priorityOrder.length < 3;
  }

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const key  = card.dataset.key;
      const rank = priorityOrder.indexOf(key);

      if (rank === -1) {
        // Not yet ranked — add if slots remain
        if (priorityOrder.length < 3) {
          priorityOrder.push(key);
        }
      } else {
        // Already ranked — remove this card and all ranked after it
        priorityOrder = priorityOrder.slice(0, rank);
      }

      refreshCards();
    });
  });

  refreshCards();

  // ---- Submit ----
  submitBtn.addEventListener("click", () => {
    const rent      = Number(rentSlider.value);
    const bedrooms  = Math.max(0, Number(document.getElementById("pref-bedrooms").value));
    const bathrooms = Math.max(0, Number(document.getElementById("pref-bathrooms").value));

    overlay.style.display = "none";

    if (typeof window.onPreferencesSubmit === "function") {
      window.onPreferencesSubmit({ rent, bedrooms, bathrooms, priority_order: priorityOrder });
    }
  });

  // ---- Public API ----
  window.showPreferencesModal = function () {
    priorityOrder = [];
    refreshCards();
    overlay.style.display = "flex";
  };
})();
