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

// Default priority order (shown at startup)
const DEFAULT_PRIORITY = ["rent", "location", "sqft"];

//--------------------------------------------------------------------

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
      <label class="pref-label">Priority Order &mdash; drag to reorder</label>
      <div id="pref-priority-row">
        <div class="pref-priority-card" data-key="rent"     draggable="true">
          <div class="pref-priority-rank"></div>
          <div class="pref-priority-name">Rent</div>
        </div>
        <div class="pref-priority-card" data-key="location" draggable="true">
          <div class="pref-priority-rank"></div>
          <div class="pref-priority-name">Location</div>
        </div>
        <div class="pref-priority-card" data-key="sqft"     draggable="true">
          <div class="pref-priority-rank"></div>
          <div class="pref-priority-name">Sq. Footage</div>
        </div>
      </div>
      <div id="pref-priority-hint">1st = most important &nbsp;·&nbsp; drag cards to reorder</div>
    </div>

    <button id="pref-submit">Find Properties</button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ---- Live rent display ----
  const rentSlider = document.getElementById("pref-rent");
  const rentValue  = document.getElementById("pref-rent-value");

  rentSlider.addEventListener("input", () => {
    rentValue.textContent = Number(rentSlider.value).toLocaleString();
  });

  // ---- Priority drag-and-drop ----
  let priorityOrder = [...DEFAULT_PRIORITY];
  let _draggedKey   = null;

  const cards      = modal.querySelectorAll(".pref-priority-card");
  const submitBtn  = document.getElementById("pref-submit");
  const priorityRow = document.getElementById("pref-priority-row");

  function refreshCards() {
    // Re-order DOM cards to match priorityOrder, update rank badges
    priorityOrder.forEach((key, rank) => {
      const card   = priorityRow.querySelector(`[data-key="${key}"]`);
      const rankEl = card.querySelector(".pref-priority-rank");
      rankEl.textContent = rank + 1;
      card.classList.add("selected");
      // Move to correct visual position
      priorityRow.appendChild(card);
    });
  }

  cards.forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      _draggedKey = card.dataset.key;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      cards.forEach(c => c.classList.remove("drag-over"));
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (card.dataset.key !== _draggedKey) card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      const targetKey = card.dataset.key;
      if (!_draggedKey || _draggedKey === targetKey) return;

      // Move dragged key to the position of target key
      const dragIdx = priorityOrder.indexOf(_draggedKey);
      const dropIdx = priorityOrder.indexOf(targetKey);
      if (dragIdx === -1 || dropIdx === -1) return;

      priorityOrder.splice(dragIdx, 1);
      // Recalculate drop index after removal
      const newDropIdx = priorityOrder.indexOf(targetKey);
      priorityOrder.splice(newDropIdx, 0, _draggedKey);

      refreshCards();
    });
  });

  refreshCards();

  // ---- Submit (always enabled — all 3 are always ranked) ----
  submitBtn.addEventListener("click", () => {
    const rent      = Number(rentSlider.value);
    const bedrooms  = Math.max(ROOM_MIN, Number(document.getElementById("pref-bedrooms").value));
    const bathrooms = Math.max(ROOM_MIN, Number(document.getElementById("pref-bathrooms").value));

    overlay.style.display = "none";

    if (typeof window.onPreferencesSubmit === "function") {
      window.onPreferencesSubmit({ rent, bedrooms, bathrooms, priority_order: priorityOrder });
    }
  });

  // ---- Public API ----
  window.showPreferencesModal = function () {
    priorityOrder = [...DEFAULT_PRIORITY];
    refreshCards();
    overlay.style.display = "flex";
  };
})();
