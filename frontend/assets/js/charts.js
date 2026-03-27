// charts.js
// Histogram (chart1) and radar triangle (chart2) for recommendation results.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

// Histogram
const CHART_NUM_BINS           = 300;   // number of bins for score (span / 300 per bar)
const HIST_BIN_WIDTH_RENT      = 50;    // $50 per bar
const HIST_BIN_WIDTH_SQFT      = 50;    // 50 sqft per bar
const HIST_BIN_WIDTH_YEAR      = 5;     // 5 years per bar
const HIST_BIN_WIDTH_STORIES   = 1;     // 1 story per bar
const CHART_BAR_COLOR_FALLBACK = "rgb(99, 173, 242)";
const CHART_BAR_OPACITY        = 1;
const CHART_AXIS_COLOR         = "#555";
const CHART_AXIS_LINE_WIDTH    = 1;
const CHART_LINE_COLOR         = "#ff5f5f";
const CHART_LINE_WIDTH         = 2;
const CHART_LINE_DASH          = [5, 4];
const CHART_TEXT_COLOR         = "#f0f0f0";
const CHART_FONT_SMALL         = "13px Roboto, sans-serif";
const CHART_FONT_TITLE         = "14px Roboto, sans-serif";
const CHART_LABEL_OFFSET_Y     = 6;
const CHART_MARGIN             = { top: 8, right: 12, bottom: 36, left: 44 };

// Radar triangle
const RADAR_MARGIN_TOP         = 36;
const RADAR_MARGIN_BOTTOM      = 36;
const RADAR_OUTER_COLOR        = "rgba(80, 80, 90, 0.6)";
const RADAR_OUTER_STROKE_WIDTH = 1.5;
const RADAR_GUIDE_COLOR        = "rgba(70, 70, 80, 0.7)";
const RADAR_GUIDE_LINE_WIDTH   = 0.7;
const RADAR_GUIDE_DASH         = [3, 4];
const RADAR_INNER_STROKE_COLOR = "rgba(255, 255, 255, 0.5)";
const RADAR_INNER_STROKE_WIDTH = 1.5;
const RADAR_INNER_ALPHA        = 0.5;
const RADAR_DOT_RADIUS         = 4;
const RADAR_LABEL_PAD          = 20;
const RADAR_FONT               = "14px Roboto, sans-serif";
const RADAR_AXIS_COLORS        = [
  "#00c2a2",
  "#0065ca",
  "#aeda37",
];
const RADAR_AXES = [
  { key: "sqft",     label: "Sqft",     direction: "higher" },
  { key: "rent_knn", label: "Rent",     direction: "lower"  },
  { key: "distance", label: "Location", direction: "lower"  },
];

//--------------------------------------------------------------------
// Module state
//--------------------------------------------------------------------
let _chartsGeojson     = null;
let _activeModeCol     = "final_score";
let _activeModeLabel   = "Score";
let _selectedProps     = null;
let _radarStats        = {};   // { key: { min, max } }
let _activeColorStops  = [];   // [[value, hexColor], ...] — mirrors current map choropleth
let _radarR            = 0;    // last computed radar R; used by histogram to cap its plotH
let _histogramData     = null; // bin geometry cached for hover hit-testing
let _histHoverEl       = null; // floating tooltip DOM element

//--------------------------------------------------------------------
// Histogram hover helpers
//--------------------------------------------------------------------

function _getHistHoverEl() {
  if (!_histHoverEl) {
    _histHoverEl = document.createElement("div");
    _histHoverEl.id = "histogram-tooltip";
    document.body.appendChild(_histHoverEl);
  }
  return _histHoverEl;
}

function _fmtHistBinLabel(start, bw) {
  const end = start + bw;
  if (_activeModeCol === "rent_knn")
    return `$${Math.round(start).toLocaleString()} – $${Math.round(end).toLocaleString()}`;
  if (_activeModeCol === "final_score")
    return `${start.toFixed(3)} – ${end.toFixed(3)}`;
  if (_activeModeCol === "built_year" || _activeModeCol === "bld_story")
    return String(Math.round(start));
  return `${Math.round(start)} – ${Math.round(end)} sqft`;
}

function _onHistMouseMove(e) {
  const d = _histogramData;
  if (!d) return;
  const rect = d.canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;
  const tip  = _getHistHoverEl();

  if (mx < d.plotLeft || mx > d.plotLeft + d.plotW || my < d.plotTop || my > d.plotTop + d.plotH) {
    tip.style.display = "none";
    return;
  }
  const binIdx = Math.min(d.numBins - 1, Math.max(0, Math.floor((mx - d.plotLeft) / d.barW)));
  const count  = d.counts[binIdx];
  if (!count) { tip.style.display = "none"; return; }

  const rangeStart    = d.minVal + binIdx * d.bw;
  tip.textContent     = `${_fmtHistBinLabel(rangeStart, d.bw)}  ·  ${count} properties`;
  tip.style.left      = (e.clientX + 14) + "px";
  tip.style.top       = (e.clientY - 36) + "px";
  tip.style.display   = "block";
}

function _onHistMouseLeave() {
  if (_histHoverEl) _histHoverEl.style.display = "none";
}

function _onHistClick(e) {
  const d = _histogramData;
  if (!d) return;
  const rect = d.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Outside the plot area → clear filter
  if (mx < d.plotLeft || mx > d.plotLeft + d.plotW || my < d.plotTop || my > d.plotTop + d.plotH) {
    if (typeof window.clearMapBinFilter === "function") window.clearMapBinFilter();
    return;
  }

  const binIdx = Math.min(d.numBins - 1, Math.max(0, Math.floor((mx - d.plotLeft) / d.barW)));
  const count  = d.counts[binIdx];

  if (!count) {
    // Empty bin → clear filter
    if (typeof window.clearMapBinFilter === "function") window.clearMapBinFilter();
    return;
  }

  const binMin = d.minVal + binIdx * d.bw;
  const binMax = binMin + d.bw;
  if (typeof window.filterMapByBin === "function") {
    window.filterMapByBin(_activeModeCol, binMin, binMax);
  }
}

/** Returns the bin width for the histogram based on the active mode column. */
function _getHistogramBinWidth(col, span) {
  if (col === "rent_knn")   return HIST_BIN_WIDTH_RENT;
  if (col === "sqft")       return HIST_BIN_WIDTH_SQFT;
  if (col === "built_year") return HIST_BIN_WIDTH_YEAR;
  if (col === "bld_story")  return HIST_BIN_WIDTH_STORIES;
  return span / CHART_NUM_BINS;   // score: 300 bins
}

//--------------------------------------------------------------------
// Color helpers
//--------------------------------------------------------------------

/** Parse a 6-digit hex string to [r, g, b] in 0–255. */
function _hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Linearly interpolate color for `value` over the given stop pairs.
 * stops: [[value, "#rrggbb"], ...]  (must be sorted ascending by value)
 * Returns a CSS rgb() string.
 */
function _interpolateColor(value, stops) {
  if (!stops.length) return CHART_BAR_COLOR_FALLBACK;
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i];
    const [v1, c1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      const t    = (value - v0) / (v1 - v0);
      const rgb0 = _hexToRgb(c0);
      const rgb1 = _hexToRgb(c1);
      const r    = Math.round(rgb0[0] + t * (rgb1[0] - rgb0[0]));
      const g    = Math.round(rgb0[1] + t * (rgb1[1] - rgb0[1]));
      const b    = Math.round(rgb0[2] + t * (rgb1[2] - rgb0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  return stops[stops.length - 1][1];
}

//--------------------------------------------------------------------
// Public API — called from main.js and map.js
//--------------------------------------------------------------------

/**
 * Initialize both charts with fresh recommendation GeoJSON.
 * Called once after /recommend returns data.
 */
function initCharts(geojsonObj) {
  _chartsGeojson   = geojsonObj;
  _activeModeCol   = "final_score";
  _activeModeLabel = "Score";
  _selectedProps   = null;

  // Fetch initial color stops for the default mode (score) from map.js
  _activeColorStops = typeof window.getColorStopsForMode === "function"
    ? window.getColorStopsForMode(geojsonObj, "score")
    : [];

  // Precompute min/max for radar axes
  for (const axis of RADAR_AXES) {
    const vals = geojsonObj.features
      .map(f => Number(f.properties[axis.key]))
      .filter(v => Number.isFinite(v));
    if (vals.length) {
      vals.sort((a, b) => a - b);
      _radarStats[axis.key] = { min: vals[0], max: vals[vals.length - 1] };
    } else {
      _radarStats[axis.key] = { min: 0, max: 1 };
    }
  }

  // Show chart panel (hidden until first recommendation result)
  const chartPanel = document.getElementById("chart");
  if (chartPanel) chartPanel.style.display = "flex";
  const handleEl = document.getElementById("chart-resize-handle");
  if (handleEl) handleEl.style.display = "block";

  // Hide placeholder, show charts row
  const placeholder = document.getElementById("chart-placeholder");
  if (placeholder) placeholder.style.display = "none";
  const chartsRow = document.getElementById("chart-charts-row");
  if (chartsRow) chartsRow.style.display = "flex";

  // Trigger map resize in case the layout shifted
  if (window.map) window.map.resize();

  _drawRadarTriangle();
  _drawHistogram();
}

/** Called by main.js reset. */
function clearCharts() {
  _chartsGeojson    = null;
  _selectedProps    = null;
  _activeColorStops = [];
  _radarR           = 0;
  _histogramData    = null;
  if (_histHoverEl) _histHoverEl.style.display = "none";

  const c1Wrap = document.getElementById("chart1-canvas-wrap");
  const c2Wrap = document.getElementById("chart2-canvas-wrap");
  if (c1Wrap) c1Wrap.innerHTML = "";
  if (c2Wrap) c2Wrap.innerHTML = "";
  const t1 = document.getElementById("chart1-title");
  const t2 = document.getElementById("chart2-title");
  if (t1) t1.textContent = "";
  if (t2) t2.textContent = "";

  const chartsRow = document.getElementById("chart-charts-row");
  if (chartsRow) chartsRow.style.display = "none";
  const placeholder = document.getElementById("chart-placeholder");
  if (placeholder) placeholder.style.display = "flex";

  // Hide the chart panel and resize handle; reset any manual sizing
  const chartPanel = document.getElementById("chart");
  if (chartPanel) chartPanel.style.display = "none";
  const handleEl = document.getElementById("chart-resize-handle");
  if (handleEl) handleEl.style.display = "none";

  const mapCon = document.getElementById("single-map-container");
  if (mapCon) { mapCon.style.flex = ""; mapCon.style.height = ""; }
  if (window.map) window.map.resize();
}

/**
 * Called by map.js when the choropleth mode button changes.
 * stops: [[value, hexColor], ...] mirroring the map expression.
 */
window.onChoroplethModeChange = function (modeId, col, label, stops) {
  _activeModeCol    = col;
  _activeModeLabel  = label;
  _activeColorStops = stops || [];
  _selectedProps    = null;
  _drawRadarTriangle();
  _drawHistogram();
};

/** Called by map.js when the user clicks a property on the map. */
window.onPropertyClick = function (props) {
  _selectedProps = props;
  _drawRadarTriangle();
  _drawHistogram();
};

//--------------------------------------------------------------------
// Resize: redraw both charts when the window resizes
//--------------------------------------------------------------------
window.addEventListener("resize", () => {
  if (_chartsGeojson) {
    _drawRadarTriangle();
    _drawHistogram();
  }
});

//--------------------------------------------------------------------
// Histogram — bars colored via the same choropleth stops as the map
//--------------------------------------------------------------------
function _drawHistogram() {
  const container = document.getElementById("chart1-canvas-wrap");
  if (!container || !_chartsGeojson) return;

  const titleEl = document.getElementById("chart1-title");
  if (titleEl) titleEl.textContent = _activeModeLabel + " Distribution";

  let canvas = container.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    container.innerHTML = "";
    container.appendChild(canvas);
  }

  // Attach interaction listeners once per canvas instance
  if (!canvas._histHoverAttached) {
    canvas.addEventListener("mousemove", _onHistMouseMove);
    canvas.addEventListener("mouseleave", _onHistMouseLeave);
    canvas.addEventListener("click",     _onHistClick);
    canvas._histHoverAttached = true;
  }

  const W = container.clientWidth;
  const H = container.clientHeight;
  if (W <= 0 || H <= 0) return;

  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Extract values for active column
  const vals = _chartsGeojson.features
    .map(f => Number(f.properties[_activeModeCol]))
    .filter(v => Number.isFinite(v));

  if (!vals.length) return;

  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const span   = maxVal - minVal || 1;

  // Dynamic bin width: score keeps 300 bins; others use domain-specific widths
  const bw      = _getHistogramBinWidth(_activeModeCol, span);
  const numBins = Math.max(1, Math.ceil(span / bw));

  // Bin data
  const counts = new Array(numBins).fill(0);
  for (const v of vals) {
    let idx = Math.floor((v - minVal) / bw);
    if (idx >= numBins) idx = numBins - 1;
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);

  const m       = CHART_MARGIN;
  const plotW   = W - m.left - m.right;
  // Cap plotH to the radar triangle's vertical span so both charts stay in sync
  const rawH    = H - m.top - m.bottom;
  const plotH   = _radarR > 0 ? Math.min(rawH, Math.ceil(_radarR * 1.5)) : rawH;
  // Align histogram bottom with radar bottom (H - m.bottom)
  const plotTop = H - m.bottom - plotH;
  if (plotW <= 0 || plotH <= 0) return;

  // Cache bin geometry for hover hit-testing
  const barW = plotW / numBins;
  _histogramData = { canvas, minVal, bw, numBins, counts, plotLeft: m.left, plotTop, plotW, plotH, barW };

  // Draw bars — each bar colored by the midpoint value through the choropleth ramp
  for (let i = 0; i < numBins; i++) {
    const barH = maxCount > 0 ? (counts[i] / maxCount) * plotH : 0;
    if (barH <= 0) continue;
    const midVal   = minVal + (i + 0.5) * bw;
    ctx.fillStyle   = _interpolateColor(midVal, _activeColorStops);
    ctx.globalAlpha = 1;
    ctx.fillRect(
      m.left + i * barW + 1,
      plotTop + plotH - barH,
      Math.max(1, barW - 2),
      barH,
    );
  }
  ctx.globalAlpha = 1;

  // Axes
  ctx.strokeStyle = CHART_AXIS_COLOR;
  ctx.lineWidth   = CHART_AXIS_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(m.left, plotTop);
  ctx.lineTo(m.left, plotTop + plotH);
  ctx.lineTo(m.left + plotW, plotTop + plotH);
  ctx.stroke();

  // X-axis labels: min, mid, max
  const fmtVal = (v) => {
    if (_activeModeCol === "rent_knn")    return `$${Math.round(v / 100) * 100}`;
    if (_activeModeCol === "final_score") return v.toFixed(2);
    return String(Math.round(v));
  };

  ctx.fillStyle    = CHART_TEXT_COLOR;
  ctx.font         = CHART_FONT_SMALL;
  ctx.textBaseline = "top";
  ctx.textAlign    = "left";
  ctx.fillText(fmtVal(minVal), m.left, plotTop + plotH + CHART_LABEL_OFFSET_Y);
  ctx.textAlign = "center";
  ctx.fillText(fmtVal((minVal + maxVal) / 2), m.left + plotW / 2, plotTop + plotH + CHART_LABEL_OFFSET_Y);
  ctx.textAlign = "right";
  ctx.fillText(fmtVal(maxVal), m.left + plotW, plotTop + plotH + CHART_LABEL_OFFSET_Y);

  // X-axis title
  ctx.textAlign    = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(_activeModeLabel, m.left + plotW / 2, H);

  // Vertical line for selected property
  if (_selectedProps) {
    const propVal = Number(_selectedProps[_activeModeCol]);
    if (Number.isFinite(propVal)) {
      const xPos = m.left + ((propVal - minVal) / span) * plotW;
      ctx.save();
      ctx.strokeStyle = CHART_LINE_COLOR;
      ctx.lineWidth   = CHART_LINE_WIDTH;
      ctx.setLineDash(CHART_LINE_DASH);
      ctx.beginPath();
      ctx.moveTo(xPos, plotTop);
      ctx.lineTo(xPos, plotTop + plotH);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle    = CHART_LINE_COLOR;
      ctx.font         = CHART_FONT_SMALL;
      ctx.textAlign    = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        fmtVal(propVal),
        Math.min(Math.max(xPos, m.left + 24), m.left + plotW - 24),
        plotTop - 2,
      );
    }
  }
}

//--------------------------------------------------------------------
// Radar triangle — inner triangle colored with per-vertex radial gradients
//--------------------------------------------------------------------
function _drawRadarTriangle() {
  const container = document.getElementById("chart2-canvas-wrap");
  if (!container || !_chartsGeojson) return;

  const titleEl = document.getElementById("chart2-title");
  if (titleEl) titleEl.textContent = "Property Profile";

  let canvas = container.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    container.innerHTML = "";
    container.appendChild(canvas);
  }

  const W = container.clientWidth;
  const H = container.clientHeight;
  if (W <= 0 || H <= 0) return;

  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const cx          = W / 2;
  // R sized so bottom vertices sit exactly at H - RADAR_MARGIN_BOTTOM (aligns with histogram x-axis)
  // and top vertex sits at RADAR_MARGIN_TOP (below title).
  // Triangle height = 3R/2, available vertical = H - RADAR_MARGIN_TOP - RADAR_MARGIN_BOTTOM
  const rFromH = Math.max(1, (H - RADAR_MARGIN_TOP - RADAR_MARGIN_BOTTOM) * 2 / 3);
  // Horizontal constraint: triangle half-width = R*√3/2, plus label padding each side
  const rFromW = Math.max(1, (W / 2 - RADAR_LABEL_PAD - 10) / (Math.sqrt(3) / 2));
  const R      = Math.min(rFromH, rFromW);
  _radarR      = R;   // share with histogram so it can cap its plotH
  // cy placed so bottom vertices land at H - RADAR_MARGIN_BOTTOM
  const cy     = H - RADAR_MARGIN_BOTTOM - R / 2;

  // Vertex angles: 0=top(Sqft), 1=bottom-right(Rent), 2=bottom-left(Location)
  const ANGLES = [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6];

  const verts = ANGLES.map(a => ({
    x: cx + R * Math.cos(a),
    y: cy + R * Math.sin(a),
  }));

  // --- Outer triangle ---
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  ctx.lineTo(verts[1].x, verts[1].y);
  ctx.lineTo(verts[2].x, verts[2].y);
  ctx.closePath();
  ctx.strokeStyle = RADAR_OUTER_COLOR;
  ctx.lineWidth   = RADAR_OUTER_STROKE_WIDTH;
  ctx.stroke();

  // --- Guide lines from center to each vertex ---
  ctx.strokeStyle = RADAR_GUIDE_COLOR;
  ctx.lineWidth   = RADAR_GUIDE_LINE_WIDTH;
  ctx.setLineDash(RADAR_GUIDE_DASH);
  for (const v of verts) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(v.x, v.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // --- Vertex labels (colored to match their axis color) ---
  ctx.font = RADAR_FONT;
  ANGLES.forEach((a, i) => {
    const lx = cx + (R + RADAR_LABEL_PAD) * Math.cos(a);
    const ly = cy + (R + RADAR_LABEL_PAD) * Math.sin(a);
    ctx.fillStyle    = RADAR_AXIS_COLORS[i];
    ctx.textAlign    = i === 0 ? "center" : i === 1 ? "left" : "right";
    ctx.textBaseline = i === 0 ? "bottom" : "middle";
    ctx.fillText(RADAR_AXES[i].label, lx, ly);
  });

  // --- Inner triangle for selected property ---
  if (!_selectedProps) return;

  const innerVerts = RADAR_AXES.map((axis, i) => {
    const val  = Number(_selectedProps[axis.key]);
    const stat = _radarStats[axis.key] || { min: 0, max: 1 };
    const rng  = stat.max - stat.min || 1;
    let score;
    if (!Number.isFinite(val)) {
      score = 0;
    } else if (axis.direction === "higher") {
      score = (val - stat.min) / rng;
    } else {
      score = (stat.max - val) / rng;
    }
    score = Math.max(0, Math.min(1, score));
    return {
      x: cx + score * R * Math.cos(ANGLES[i]),
      y: cy + score * R * Math.sin(ANGLES[i]),
    };
  });

  // Centroid of inner triangle (used to size the radial gradients)
  const icx = (innerVerts[0].x + innerVerts[1].x + innerVerts[2].x) / 3;
  const icy = (innerVerts[0].y + innerVerts[1].y + innerVerts[2].y) / 3;

  // Clip subsequent drawing to the inner triangle shape
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(innerVerts[0].x, innerVerts[0].y);
  ctx.lineTo(innerVerts[1].x, innerVerts[1].y);
  ctx.lineTo(innerVerts[2].x, innerVerts[2].y);
  ctx.closePath();
  ctx.clip();

  // Draw three overlapping radial gradients — one per vertex, each fading
  // from its axis color (at the vertex) to transparent (toward the centroid).
  for (let i = 0; i < 3; i++) {
    const v    = innerVerts[i];
    const dist = Math.max(8, Math.hypot(v.x - icx, v.y - icy) * 1.6);
    const [r, g, b] = _hexToRgb(RADAR_AXIS_COLORS[i]);
    const grad = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, dist);
    grad.addColorStop(0,   `rgba(${r},${g},${b},${RADAR_INNER_ALPHA})`);
    grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();  // end clip

  // Colored dots at each inner vertex
  for (let i = 0; i < 3; i++) {
    const [r, g, b] = _hexToRgb(RADAR_AXIS_COLORS[i]);
    ctx.beginPath();
    ctx.arc(innerVerts[i].x, innerVerts[i].y, RADAR_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
  }
}

//--------------------------------------------------------------------
// Expose public functions
//--------------------------------------------------------------------
window.initCharts  = initCharts;
window.clearCharts = clearCharts;

/** Called by the resize handle drag logic in main.js to redraw charts at new size. */
window.resizeCharts = function () {
  if (_chartsGeojson) {
    _drawRadarTriangle();
    _drawHistogram();
  }
};
