// neighborhood.js
// Sidebar UI for neighborhood selection.
// Receives map-click events from map.js via window.onNeighborhoodClick().

let _selectedNeighborhood = null; // { name, lon, lat }

function showNeighborhoodSelector() {
  _selectedNeighborhood = null;

  const outputBox = document.getElementById("output-message");
  if (!outputBox) return;
  outputBox.innerHTML = "";

  const panel = document.createElement("div");
  panel.id = "neighborhood-panel";

  panel.innerHTML = `
    <div id="neighborhood-header">Select a Neighborhood</div>
    <div id="neighborhood-instruction">Click a neighborhood polygon on the map to set your location reference.</div>
    <div id="neighborhood-selected-display">
      <div id="neighborhood-selected-label">—</div>
    </div>
    <button id="neighborhood-confirm" disabled>Confirm &#8594;</button>
  `;

  outputBox.appendChild(panel);

  document.getElementById("neighborhood-confirm").addEventListener("click", () => {
    if (_selectedNeighborhood && typeof window.onNeighborhoodSubmit === "function") {
      window.onNeighborhoodSubmit(_selectedNeighborhood);
    }
  });

  // Called by map.js when the user clicks a neighborhood polygon.
  // Receives the neighborhood name and its centroid coordinates.
  window.onNeighborhoodClick = function (name, lon, lat) {
    _selectedNeighborhood = { name, lon, lat };

    const label = document.getElementById("neighborhood-selected-label");
    if (label) label.textContent = name;

    const btn = document.getElementById("neighborhood-confirm");
    if (btn) btn.disabled = false;
  };
}

window.showNeighborhoodSelector = showNeighborhoodSelector;
