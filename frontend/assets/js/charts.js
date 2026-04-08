// charts.js
// Histogram (chart1) and radar triangle (chart2) for recommendation results.

//--------------------------------------------------------------------
// Configuration
//--------------------------------------------------------------------

// Histogram — mode-independent
const CHART_NUM_BINS        = 50;    // number of bins for score (span / 50 per bar)
const HIST_BIN_WIDTH_RENT     = 10;   // $10 per bar
const HIST_BIN_WIDTH_SQFT     = 50;   // 50 sqft per bar
const HIST_BIN_WIDTH_YEAR     = 5;    // 5 years per bar
const HIST_BIN_WIDTH_STORIES  = 1;   // 1 story per bar
const HIST_BIN_WIDTH_DIST     = 50;   // 50 ft per bar (distance columns)
const HIST_BIN_WIDTH_ORDINAL  = 1;   // 1 per bar (elevator 0/1, noise 0–4)
const CHART_BAR_OPACITY      = 1;
const CHART_AXIS_LINE_WIDTH  = 0.5;
const CHART_LINE_WIDTH       = 0.5;
const CHART_LINE_DASH        = [5, 4];
const CHART_FONT_SMALL       = "13px Roboto, sans-serif";
const CHART_FONT_TITLE       = "14px Roboto, sans-serif";
const CHART_LABEL_OFFSET_Y   = 6;
const CHART_MARGIN           = { top: 28, right: 12, bottom: 36, left: 44 };

// Histogram — dark / bright color pairs
const CHART_BAR_COLOR_FALLBACK        = "rgb(99, 173, 242)";   // dark
const CHART_BAR_COLOR_FALLBACK_BRIGHT = "rgb(9, 77, 150)";   // bright

const CHART_AXIS_COLOR        = "#6b6b6b";    // dark
const CHART_AXIS_COLOR_BRIGHT = "#393939";   // bright

const CHART_LINE_COLOR        = "#ff5f5f";  // dark
const CHART_LINE_COLOR_BRIGHT = "#950007";  // bright

const CHART_TEXT_COLOR        = "#f0f0f0";  // dark
const CHART_TEXT_COLOR_BRIGHT = "#111111";  // bright

// Radar triangle — mode-independent
const RADAR_MARGIN_TOP         = 36;
const RADAR_MARGIN_BOTTOM      = 36;
const RADAR_OUTER_STROKE_WIDTH = 0.5;
const RADAR_GUIDE_LINE_WIDTH   = 0.5;
const RADAR_GUIDE_DASH         = [3, 4];
const RADAR_INNER_ALPHA        = 0.5;
const RADAR_DOT_RADIUS         = 4;
const RADAR_LABEL_PAD          = 20;
const RADAR_FONT               = "14px Roboto, sans-serif";

// Radar triangle — dark / bright color pairs
const RADAR_OUTER_COLOR        = "rgba(80,  80,  90,  0.6)";   // dark
const RADAR_OUTER_COLOR_BRIGHT = "rgba(50,  55,  70,  0.7)";   // bright

const RADAR_GUIDE_COLOR        = "rgba(70,  70,  80,  0.7)";   // dark
const RADAR_GUIDE_COLOR_BRIGHT = "rgba(40,  45,  60,  0.75)";  // bright

// Radar axis vertex colors — dark / bright (one entry per axis in pool, order matches RADAR_AXES_POOL)
const RADAR_AXIS_COLORS = [
  "#0065ca",   // dark — blue          (rent)
  "#aeda37",   // dark — yellow-green  (location)
  "#00c2a2",   // dark — teal          (sqft)
  "#c44dff",   // dark — purple        (subway)
  "#e8820c",   // dark — orange        (green space)
  "#ff4f78",   // dark — rose          (noise)
];
const RADAR_AXIS_COLORS_BRIGHT = [
  "#002d6d",   // bright — dark blue   (rent)
  "#445700",   // bright — dark olive  (location)
  "#006b58",   // bright — dark teal   (sqft)
  "#5e0099",   // bright — dark purple (subway)
  "#7a3f00",   // bright — dark orange (green space)
  "#9b002b",   // bright — dark rose   (noise)
];

// Full pool of available radar axes — user selects 3–6 of these
const RADAR_AXES_POOL = [
  { key: "rent_knn",           label: "Rent",                  direction: "lower"  },
  { key: "distance",           label: "Location",              direction: "lower"  },
  { key: "sqft",               label: "Sqft",                  direction: "higher" },
  { key: "dist_subway_ft",     label: "Subway Distance",       direction: "higher" },
  { key: "dist_greenspace_ft", label: "Green Space Distance",  direction: "higher" },
  {
    key:       "noise_level",
    label:     "Noise Comfort",
    direction: "lower",
    toNum:     v => ({ "very low": 0, "low": 1, "medium": 2, "high": 3, "very high": 4 }[
                       String(v).toLowerCase().trim()
                     ] ?? NaN),
  },
];

//--------------------------------------------------------------------
// Building class code → category (snake_case; converted to Title Case at render time)
//--------------------------------------------------------------------
const BLDG_CLASS_MAP = {
  "A0":"single_family","A1":"single_family","A2":"single_family","A3":"single_family",
  "A4":"single_family","A5":"attached_family","A6":"attached_family","A7":"attached_family",
  "A8":"attached_family","A9":"misc_residential",
  "B1":"two_family","B2":"two_family","B3":"walkup_apartment","B9":"misc_residential",
  "C0":"walkup_apartment","C1":"walkup_apartment","C2":"walkup_apartment","C3":"walkup_apartment",
  "C4":"walkup_apartment","C5":"walkup_apartment","C6":"walkup_apartment","C7":"walkup_apartment",
  "C8":"walkup_apartment","C9":"walkup_apartment","CM":"mixed_use",
  "D0":"elevator_apartment","D1":"elevator_apartment","D2":"elevator_apartment",
  "D3":"elevator_apartment","D4":"elevator_apartment","D5":"elevator_apartment",
  "D6":"elevator_apartment","D7":"elevator_apartment","D8":"elevator_apartment",
  "D9":"elevator_apartment",
  "E1":"office","E2":"office","E7":"office","E9":"office",
  "F1":"factory","F4":"factory","F5":"factory","F9":"factory",
  "G0":"parking","G1":"parking","G2":"parking","G3":"parking","G4":"parking",
  "G5":"parking","G6":"parking","G7":"parking","G8":"parking","G9":"parking",
  "GU":"parking","GW":"parking",
  "H1":"hotel","H2":"hotel","H3":"hotel","H6":"hotel","H9":"hotel",
  "HB":"hotel","HR":"hotel","HS":"hotel",
  "I1":"hospital","I4":"hospital","I5":"hospital","I6":"hospital","I7":"hospital","I9":"hospital",
  "J5":"theater","J6":"theater","J9":"theater",
  "K1":"warehouse","K2":"warehouse","K4":"warehouse","K5":"warehouse",
  "K7":"warehouse","K9":"warehouse",
  "M1":"industrial","M2":"industrial","M3":"industrial","M4":"industrial","M9":"industrial",
  "N2":"entertainment","N3":"entertainment","N4":"entertainment","N9":"entertainment",
  "O1":"office","O2":"office","O3":"office","O4":"office","O5":"office",
  "O6":"office","O7":"office","O8":"office","O9":"office",
  "P2":"garage","P5":"garage","P7":"garage","P9":"garage",
  "Q1":"education","Q8":"education","Q9":"education",
  "S0":"retail","S1":"retail","S2":"retail","S3":"retail",
  "S4":"retail","S5":"retail","S9":"retail",
  "V0":"vacant_land","V1":"vacant_land","V2":"vacant_land","V3":"vacant_land",
  "W1":"utility","W2":"utility","W3":"utility","W4":"utility",
  "W6":"utility","W8":"utility","W9":"utility",
  "Y4":"religious","Y9":"religious",
  "Z0":"misc","Z2":"misc","Z4":"misc","Z8":"misc","Z9":"misc",
  "null":"unknown",
};

/** Convert a bldg_class code to a human-readable label. */
function _formatBldgType(code) {
  const raw = BLDG_CLASS_MAP[String(code)] || "unknown";
  return raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

//--------------------------------------------------------------------
// Module state
//--------------------------------------------------------------------
let _chartsGeojson     = null;
let _activeModeId      = "score";      // choropleth mode id — used to refresh color stops on theme switch
let _activeModeCol     = "final_score";
let _activeModeLabel   = "Score";
let _chart2Mode        = "spec";       // "spec" | "radar" — which view is shown in chart2
let _selectedProps     = null;
let _radarStats        = {};   // { key: { min, max } }
let _activeColorStops  = [];   // [[value, hexColor], ...] — mirrors current map choropleth
let _radarR            = 0;    // last computed radar R; used by histogram to cap its plotH
let _histogramData     = null; // bin geometry cached for hover hit-testing
let _histHoverEl       = null; // floating tooltip DOM element
// Active radar axes (3–6 entries from RADAR_AXES_POOL); first 3 selected by default
let _activeRadarAxes   = RADAR_AXES_POOL.slice(0, 3);

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

const _NOISE_LABELS = ["Very Low", "Low", "Medium", "High", "Very High"];

function _fmtHistBinLabel(start, bw) {
  const end = start + bw;
  if (_activeModeCol === "rent_knn")
    return `$${Math.round(start).toLocaleString()} – $${Math.round(end).toLocaleString()}`;
  if (_activeModeCol === "final_score")
    return `${start.toFixed(3)} – ${end.toFixed(3)}`;
  if (_activeModeCol === "built_year" || _activeModeCol === "bld_story")
    return String(Math.round(start));
  if (_activeModeCol === "elevator")
    return Math.round(start) === 0 ? "No Elevator" : "Elevator";
  if (_activeModeCol === "noise_level_ord")
    return _NOISE_LABELS[Math.round(start)] || String(Math.round(start));
  if (_activeModeCol === "dist_major_park_ft" ||
      _activeModeCol === "dist_greenspace_ft"  ||
      _activeModeCol === "dist_subway_ft")
    return `${Math.round(start).toLocaleString()} – ${Math.round(end).toLocaleString()} ft`;
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

  // Outside plot area X bounds or below plot bottom → clear filter
  if (mx < d.plotLeft || mx > d.plotLeft + d.plotW || my > d.plotTop + d.plotH) {
    if (typeof window.clearMapBinFilter === "function") window.clearMapBinFilter();
    return;
  }

  const binIdx = Math.min(d.numBins - 1, Math.max(0, Math.floor((mx - d.plotLeft) / d.barW)));
  const count  = d.counts[binIdx];

  // Compute the top pixel of this bar; click above it means empty space → clear filter
  const barH   = d.maxCount > 0 ? (count / d.maxCount) * d.plotH : 0;
  const barTop = d.plotTop + d.plotH - barH;

  if (!count || my < barTop) {
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
  if (col === "rent_knn")          return HIST_BIN_WIDTH_RENT;
  if (col === "sqft")              return HIST_BIN_WIDTH_SQFT;
  if (col === "built_year")        return HIST_BIN_WIDTH_YEAR;
  if (col === "bld_story")         return HIST_BIN_WIDTH_STORIES;
  if (col === "elevator")          return HIST_BIN_WIDTH_ORDINAL;
  if (col === "noise_level_ord")   return HIST_BIN_WIDTH_ORDINAL;
  if (col === "dist_major_park_ft") return span / 50;   // 50 bins
  if (col === "dist_greenspace_ft" ||
      col === "dist_subway_ft")    return HIST_BIN_WIDTH_DIST;
  return span / CHART_NUM_BINS;   // score: 50 bins
}

//--------------------------------------------------------------------
// Color helpers
//--------------------------------------------------------------------

/**
 * Returns chart colors for the current dark/bright mode.
 * radarAxisColors is indexed by position within RADAR_AXES_POOL.
 */
function _chartColors() {
  const bright = document.body.classList.contains("bright");
  return {
    axis:            bright ? CHART_AXIS_COLOR_BRIGHT         : CHART_AXIS_COLOR,
    text:            bright ? CHART_TEXT_COLOR_BRIGHT         : CHART_TEXT_COLOR,
    line:            bright ? CHART_LINE_COLOR_BRIGHT         : CHART_LINE_COLOR,
    barFallback:     bright ? CHART_BAR_COLOR_FALLBACK_BRIGHT : CHART_BAR_COLOR_FALLBACK,
    radarOuter:      bright ? RADAR_OUTER_COLOR_BRIGHT        : RADAR_OUTER_COLOR,
    radarGuide:      bright ? RADAR_GUIDE_COLOR_BRIGHT        : RADAR_GUIDE_COLOR,
    radarAxisColors: bright ? RADAR_AXIS_COLORS_BRIGHT        : RADAR_AXIS_COLORS,
  };
}

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
  if (!stops.length) return _chartColors().barFallback;
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
  _activeModeId    = "score";
  _activeModeCol   = "final_score";
  _activeModeLabel = "Score";
  _chart2Mode      = "spec";
  _selectedProps   = null;

  // Fetch initial color stops for the default mode (score) from map.js
  _activeColorStops = typeof window.getColorStopsForMode === "function"
    ? window.getColorStopsForMode(geojsonObj, "score")
    : [];

  // Reset active axes to default first 3 on each new dataset
  _activeRadarAxes = RADAR_AXES_POOL.slice(0, 3);

  // Precompute min/max for all pool axes
  for (const axis of RADAR_AXES_POOL) {
    const toNum = axis.toNum || (v => Number(v));
    const vals = geojsonObj.features
      .map(f => toNum(f.properties[axis.key]))
      .filter(v => Number.isFinite(v));
    if (vals.length) {
      vals.sort((a, b) => a - b);
      _radarStats[axis.key] = { min: vals[0], max: vals[vals.length - 1] };
    } else {
      _radarStats[axis.key] = { min: 0, max: 1 };
    }
  }

  // Build chart2 UI: mode toggle + spec card + axis selector
  _buildChart2UI();

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

  _drawHistogram();   // radar draws only if _chart2Mode === "radar"; spec was already rendered in _buildChart2UI
}

/** Called by main.js reset. */
function clearCharts() {
  _chartsGeojson    = null;
  _activeModeId     = "score";
  _chart2Mode       = "spec";
  _selectedProps    = null;
  _activeColorStops = [];
  _radarR           = 0;
  _histogramData    = null;
  _activeRadarAxes  = RADAR_AXES_POOL.slice(0, 3);
  if (_histHoverEl) _histHoverEl.style.display = "none";

  // Rescue canvas-wrap from radar-body before removing it
  const chart2El   = document.getElementById("chart2");
  const c2Wrap     = document.getElementById("chart2-canvas-wrap");
  const radarBodyC = document.getElementById("chart2-radar-body");
  if (radarBodyC && c2Wrap && radarBodyC.contains(c2Wrap) && chart2El) {
    chart2El.appendChild(c2Wrap);
  }
  ["chart2-toggle", "chart2-spec-wrap", "chart2-axis-selector", "chart2-radar-body"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const c1Wrap = document.getElementById("chart1-canvas-wrap");
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
  _activeModeId     = modeId;
  _activeModeCol    = col;
  _activeModeLabel  = label;
  _activeColorStops = stops || [];
  _selectedProps    = null;
  if (_chart2Mode === "spec") _renderPropertySpec();
  else _drawRadarTriangle();
  _drawHistogram();
};

/** Called by map.js when the user clicks a property on the map. */
window.onPropertyClick = function (props) {
  _selectedProps = props;
  if (_chart2Mode === "spec") _renderPropertySpec();
  else _drawRadarTriangle();
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
  const bw = _getHistogramBinWidth(_activeModeCol, span);

  // For ordinal columns with a fixed integer range, anchor at 0 and force the
  // exact bin count so the max value gets its own bin (avoids the off-by-one
  // where Math.ceil(span/bw) clamps the last category into the second-to-last).
  let effMin, numBins;
  if (_activeModeCol === "elevator") {
    effMin = 0; numBins = 2;
  } else if (_activeModeCol === "noise_level_ord") {
    effMin = 0; numBins = 5;
  } else {
    effMin = minVal;
    numBins = Math.max(1, Math.ceil(span / bw));
  }

  // Bin data
  const counts = new Array(numBins).fill(0);
  for (const v of vals) {
    let idx = Math.floor((v - effMin) / bw);
    if (idx < 0)          idx = 0;
    if (idx >= numBins)   idx = numBins - 1;
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);

  const m       = CHART_MARGIN;
  const plotW   = W - m.left - m.right;
  const plotH   = H - m.top - m.bottom;
  const plotTop = m.top;
  if (plotW <= 0 || plotH <= 0) return;

  // Cache bin geometry for hover hit-testing
  const barW = plotW / numBins;
  _histogramData = { canvas, minVal: effMin, bw, numBins, counts, maxCount, plotLeft: m.left, plotTop, plotW, plotH, barW };

  // Draw bars — each bar colored by the midpoint value through the choropleth ramp
  for (let i = 0; i < numBins; i++) {
    const barH = maxCount > 0 ? (counts[i] / maxCount) * plotH : 0;
    if (barH <= 0) continue;
    // Ordinal columns: use the exact integer value so color matches the map expression
    const midVal = (_activeModeCol === "elevator" || _activeModeCol === "noise_level_ord")
      ? effMin + i * bw
      : effMin + (i + 0.5) * bw;
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
  const cc = _chartColors();
  ctx.strokeStyle = cc.axis;
  ctx.lineWidth   = CHART_AXIS_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(m.left, plotTop);
  ctx.lineTo(m.left, plotTop + plotH);
  ctx.lineTo(m.left + plotW, plotTop + plotH);
  ctx.stroke();

  // X-axis labels: min, mid, max — with special cases for categorical / score columns
  const _isScoreCol  = _activeModeCol === "final_score";
  const _isElevCol   = _activeModeCol === "elevator";
  const _isNoiseCol  = _activeModeCol === "noise_level_ord";

  const fmtVal = (v) => {
    if (_isScoreCol)                      return "";   // replaced by semantic labels below
    if (_isElevCol)                       return "";
    if (_isNoiseCol)                      return "";
    if (_activeModeCol === "rent_knn")    return `$${Math.round(v / 100) * 100}`;
    if (_activeModeCol === "dist_major_park_ft" ||
        _activeModeCol === "dist_greenspace_ft"  ||
        _activeModeCol === "dist_subway_ft")
      return `${Math.round(v).toLocaleString()} ft`;
    return String(Math.round(v));
  };

  ctx.fillStyle    = cc.text;
  ctx.font         = CHART_FONT_SMALL;
  ctx.textBaseline = "top";

  if (_isScoreCol) {
    ctx.textAlign = "left";
    ctx.fillText("Not Favorable", m.left, plotTop + plotH + CHART_LABEL_OFFSET_Y);
    ctx.textAlign = "right";
    ctx.fillText("Very Favorable", m.left + plotW, plotTop + plotH + CHART_LABEL_OFFSET_Y);
  } else if (_isElevCol) {
    ctx.textAlign = "left";
    ctx.fillText("No Elevator", m.left, plotTop + plotH + CHART_LABEL_OFFSET_Y);
    ctx.textAlign = "right";
    ctx.fillText("Elevator", m.left + plotW, plotTop + plotH + CHART_LABEL_OFFSET_Y);
  } else if (_isNoiseCol) {
    ctx.textAlign = "left";
    ctx.fillText("Very Low", m.left, plotTop + plotH + CHART_LABEL_OFFSET_Y);
    ctx.textAlign = "right";
    ctx.fillText("Very High", m.left + plotW, plotTop + plotH + CHART_LABEL_OFFSET_Y);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(fmtVal(minVal), m.left, plotTop + plotH + CHART_LABEL_OFFSET_Y);
    ctx.textAlign = "center";
    ctx.fillText(fmtVal((minVal + maxVal) / 2), m.left + plotW / 2, plotTop + plotH + CHART_LABEL_OFFSET_Y);
    ctx.textAlign = "right";
    ctx.fillText(fmtVal(maxVal), m.left + plotW, plotTop + plotH + CHART_LABEL_OFFSET_Y);
  }

  // X-axis title — append ft unit for distance columns
  const _distCols = ["dist_major_park_ft", "dist_greenspace_ft", "dist_subway_ft"];
  const axisTitle = _distCols.includes(_activeModeCol)
    ? `${_activeModeLabel} (ft)`
    : _activeModeLabel;
  ctx.textAlign    = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(axisTitle, m.left + plotW / 2, H);

  // Vertical line for selected property
  if (_selectedProps) {
    const propVal = Number(_selectedProps[_activeModeCol]);
    if (Number.isFinite(propVal)) {
      const effSpan = numBins * bw || 1;
      const xPos = m.left + ((propVal - effMin) / effSpan) * plotW;
      ctx.save();
      ctx.strokeStyle = cc.line;
      ctx.lineWidth   = CHART_LINE_WIDTH;
      ctx.setLineDash(CHART_LINE_DASH);
      ctx.beginPath();
      ctx.moveTo(xPos, plotTop);
      ctx.lineTo(xPos, plotTop + plotH);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle    = cc.line;
      ctx.font         = CHART_FONT_SMALL;
      ctx.textAlign    = "center";
      ctx.textBaseline = "bottom";
      // For score column, show numeric value above the marker line
      const markerLabel = _isScoreCol
        ? propVal.toFixed(3)
        : _isElevCol
          ? (propVal >= 1 ? "Elevator" : "No Elevator")
          : _isNoiseCol
            ? (_NOISE_LABELS[Math.round(propVal)] || String(Math.round(propVal)))
            : fmtVal(propVal);
      ctx.fillText(
        markerLabel,
        Math.min(Math.max(xPos, m.left + 24), m.left + plotW - 24),
        plotTop - 2,
      );
    }
  }
}

//--------------------------------------------------------------------
// Radar axis selector — pill buttons between chart2-title and canvas
//--------------------------------------------------------------------
function _buildAxisSelector(container) {
  // Remove existing selector if any
  const existing = document.getElementById("chart2-axis-selector");
  if (existing) existing.remove();

  // Use provided container or fall back to the radar-body div
  const target = container || document.getElementById("chart2-radar-body");
  if (!target) return;

  const sel = document.createElement("div");
  sel.id = "chart2-axis-selector";

  RADAR_AXES_POOL.forEach((axis, poolIdx) => {
    const btn = document.createElement("button");
    btn.className    = "radar-axis-btn";
    btn.textContent  = axis.label;
    btn.dataset.key  = axis.key;

    const isActive = _activeRadarAxes.some(a => a.key === axis.key);
    if (isActive) btn.classList.add("active");

    // Color the active indicator stripe using the axis palette color
    btn.style.setProperty("--axis-color",
      document.body.classList.contains("bright")
        ? RADAR_AXIS_COLORS_BRIGHT[poolIdx]
        : RADAR_AXIS_COLORS[poolIdx]
    );

    btn.addEventListener("click", () => {
      const activeKeys = _activeRadarAxes.map(a => a.key);
      const idx        = activeKeys.indexOf(axis.key);

      if (idx !== -1) {
        // Deselect — require minimum 3 active
        if (_activeRadarAxes.length <= 3) return;
        _activeRadarAxes = _activeRadarAxes.filter(a => a.key !== axis.key);
        btn.classList.remove("active");
      } else {
        // Select — maximum 6 (all pool axes)
        if (_activeRadarAxes.length >= RADAR_AXES_POOL.length) return;
        _activeRadarAxes = [..._activeRadarAxes, axis];
        btn.classList.add("active");
      }

      _drawRadarTriangle();
    });

    sel.appendChild(btn);
  });

  target.appendChild(sel);
}

//--------------------------------------------------------------------
// chart2 — mode toggle, spec/radar view management
//--------------------------------------------------------------------

/** Applies visibility of spec-wrap vs radar-body (canvas + axis selector) for the current _chart2Mode. */
function _applyChart2ModeVisibility() {
  const isSpec    = _chart2Mode === "spec";
  const specEl    = document.getElementById("chart2-spec-wrap");
  const radarBody = document.getElementById("chart2-radar-body");
  if (specEl)    specEl.style.display    = isSpec ? "flex" : "none";
  if (radarBody) radarBody.style.display = isSpec ? "none" : "flex";
}

/**
 * Build the full chart2 UI: mode toggle + spec-wrap + axis-selector.
 * Called from initCharts; also used to rebuild on reset.
 */
function _buildChart2UI() {
  // Rescue canvas-wrap from radar-body before teardown, then remove dynamic elements
  const chart2El  = document.getElementById("chart2");
  const canvasEl  = document.getElementById("chart2-canvas-wrap");
  const radarBody = document.getElementById("chart2-radar-body");
  if (radarBody && canvasEl && radarBody.contains(canvasEl) && chart2El) {
    chart2El.appendChild(canvasEl);
  }
  ["chart2-toggle", "chart2-spec-wrap", "chart2-axis-selector", "chart2-radar-body"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const titleEl = document.getElementById("chart2-title");
  if (!titleEl || !canvasEl) return;
  titleEl.textContent = "Property Profile";

  // --- Mode toggle ---
  const toggle = document.createElement("div");
  toggle.id = "chart2-toggle";

  [{ id: "spec", label: "Specification" }, { id: "radar", label: "Radar" }].forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.className    = "chart2-tab" + (_chart2Mode === id ? " active" : "");
    btn.dataset.mode = id;
    btn.textContent  = label;
    btn.addEventListener("click", () => {
      if (_chart2Mode === id) return;
      _chart2Mode = id;
      toggle.querySelectorAll(".chart2-tab")
        .forEach(b => b.classList.toggle("active", b.dataset.mode === id));
      _applyChart2ModeVisibility();
      if (id === "radar") _drawRadarTriangle();
      else _renderPropertySpec();
    });
    toggle.appendChild(btn);
  });

  titleEl.insertAdjacentElement("afterend", toggle);

  // --- Spec wrap ---
  const specWrap = document.createElement("div");
  specWrap.id = "chart2-spec-wrap";
  toggle.insertAdjacentElement("afterend", specWrap);

  // --- Radar body: row container with canvas on left + axis selector on right ---
  const radarBodyEl = document.createElement("div");
  radarBodyEl.id = "chart2-radar-body";
  specWrap.insertAdjacentElement("afterend", radarBodyEl);
  radarBodyEl.appendChild(canvasEl);        // move canvas into radar body
  _buildAxisSelector(radarBodyEl);          // axis selector appended to the right

  _applyChart2ModeVisibility();
  _renderPropertySpec();
}

/**
 * Render the property specification card into #chart2-spec-wrap.
 * Shows a placeholder when no property is selected.
 */
function _renderPropertySpec() {
  const specEl = document.getElementById("chart2-spec-wrap");
  if (!specEl) return;

  if (!_selectedProps) {
    specEl.innerHTML = '<div class="spec-placeholder">Click a property on the map<br>or from the top 10 list<br>to view details</div>';
    return;
  }

  const p = _selectedProps;

  // Room layout
  const lr       = Number(p.livingroomnum) || 0;
  const bd       = Number(p.bedroomnum)    || 0;
  const ba       = Number(p.bathroomnum)   || 0;
  const isStudio = lr === 0;
  const layoutStr = isStudio
    ? `Studio · ${ba} Bath`
    : [lr > 0 ? `${lr} LR` : null, `${bd} Bd`, `${ba} Ba`].filter(Boolean).join(" · ");

  // Elevator (handles boolean or numeric from GeoJSON)
  const hasElev = (p.elevator === true || p.elevator === 1 ||
                   p.elevator === "true" || p.elevator === "1");

  // Noise level — capitalize each word
  const noiseFmt = p.noise_level
    ? String(p.noise_level).replace(/\b\w/g, c => c.toUpperCase())
    : "—";

  const fDist = v => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) ? `${Math.round(n).toLocaleString()} ft` : "—";
  };
  const fOr = v => (v != null && v !== "" && v !== 0) ? v : "—";

  const rows = [
    ["Rent",              p.rent_knn  != null ? `$${Math.round(p.rent_knn).toLocaleString()}/mo` : "—"],
    ["Size",              p.sqft      != null ? `${Math.round(p.sqft).toLocaleString()} sqft`    : "—"],
    ["Layout",            layoutStr],
    ["Neighborhood",      fOr(p.small_n)],
    ["Building Type",     _formatBldgType(p.bldg_class)],
    ["Stories",           p.bld_story  != null ? Math.round(p.bld_story)  : "—"],
    ["Elevator",          hasElev ? "Yes" : "No"],
    ["Built",             p.built_year != null ? Math.round(p.built_year) : "—"],
    ["Subway Distance",   fDist(p.dist_subway_ft)],
    ["Noise Level",       noiseFmt],
    ["Nearest Park",      fOr(p.nearest_major_park)],
    ["Park Distance",     fDist(p.dist_major_park_ft)],
    ["Greenspace Dist.",  fDist(p.dist_greenspace_ft)],
  ];

  specEl.innerHTML = `<table class="prop-spec-table">${
    rows.map(([label, value]) =>
      `<tr><td class="spec-label">${label}</td><td class="spec-value">${value}</td></tr>`
    ).join("")
  }</table>`;
}

//--------------------------------------------------------------------
// Radar polygon — N axes, inner polygon colored with per-vertex radial gradients
//--------------------------------------------------------------------
function _drawRadarTriangle() {
  if (_chart2Mode !== "radar") return;
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

  const N  = _activeRadarAxes.length;
  const cx = W / 2;
  // R constrained by both vertical and horizontal space with label padding
  const rFromH = Math.max(1, (H - RADAR_MARGIN_TOP - RADAR_MARGIN_BOTTOM) / 2);
  const rFromW = Math.max(1, W / 2 - RADAR_LABEL_PAD - 10);
  const R      = Math.min(rFromH, rFromW);
  _radarR      = R;
  const cy     = (RADAR_MARGIN_TOP + (H - RADAR_MARGIN_BOTTOM)) / 2;

  // Evenly spaced vertex angles starting from top (-PI/2)
  const ANGLES = Array.from({ length: N }, (_, i) => -Math.PI / 2 + (2 * Math.PI * i / N));

  const verts = ANGLES.map(a => ({
    x: cx + R * Math.cos(a),
    y: cy + R * Math.sin(a),
  }));

  const rc = _chartColors();

  // --- Outer polygon ---
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < N; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.strokeStyle = rc.radarOuter;
  ctx.lineWidth   = RADAR_OUTER_STROKE_WIDTH;
  ctx.stroke();

  // --- Guide lines from center to each vertex ---
  ctx.strokeStyle = rc.radarGuide;
  ctx.lineWidth   = RADAR_GUIDE_LINE_WIDTH;
  ctx.setLineDash(RADAR_GUIDE_DASH);
  for (const v of verts) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(v.x, v.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // --- Vertex labels (colored by their pool index color) ---
  ctx.font = RADAR_FONT;
  _activeRadarAxes.forEach((axis, i) => {
    const a  = ANGLES[i];
    const lx = cx + (R + RADAR_LABEL_PAD) * Math.cos(a);
    const ly = cy + (R + RADAR_LABEL_PAD) * Math.sin(a);
    const poolIdx = RADAR_AXES_POOL.findIndex(p => p.key === axis.key);
    ctx.fillStyle    = rc.radarAxisColors[poolIdx] || rc.radarAxisColors[0];
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    ctx.textAlign    = cosA < -0.1 ? "right" : cosA > 0.1 ? "left" : "center";
    ctx.textBaseline = sinA < -0.1 ? "bottom" : sinA > 0.1 ? "top"  : "middle";
    ctx.fillText(axis.label, lx, ly);
  });

  // --- Inner polygon for selected property ---
  if (!_selectedProps) return;

  const innerVerts = _activeRadarAxes.map((axis, i) => {
    const toNum = axis.toNum || (v => Number(v));
    const val   = toNum(_selectedProps[axis.key]);
    const stat  = _radarStats[axis.key] || { min: 0, max: 1 };
    const rng   = stat.max - stat.min || 1;
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

  // Centroid of inner polygon (used to size the radial gradients)
  const icx = innerVerts.reduce((s, v) => s + v.x, 0) / N;
  const icy = innerVerts.reduce((s, v) => s + v.y, 0) / N;

  // Clip to inner polygon shape
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(innerVerts[0].x, innerVerts[0].y);
  for (let i = 1; i < N; i++) ctx.lineTo(innerVerts[i].x, innerVerts[i].y);
  ctx.closePath();
  ctx.clip();

  // Overlapping radial gradients — one per vertex
  for (let i = 0; i < N; i++) {
    const v       = innerVerts[i];
    const poolIdx = RADAR_AXES_POOL.findIndex(p => p.key === _activeRadarAxes[i].key);
    const dist    = Math.max(8, Math.hypot(v.x - icx, v.y - icy) * 1.6);
    const [r, g, b] = _hexToRgb(rc.radarAxisColors[poolIdx] || rc.radarAxisColors[0]);
    const grad = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, dist);
    grad.addColorStop(0, `rgba(${r},${g},${b},${RADAR_INNER_ALPHA})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();

  // Colored dots at each inner vertex
  for (let i = 0; i < N; i++) {
    const poolIdx = RADAR_AXES_POOL.findIndex(p => p.key === _activeRadarAxes[i].key);
    const [r, g, b] = _hexToRgb(rc.radarAxisColors[poolIdx] || rc.radarAxisColors[0]);
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

/** Called by main.js when the color mode toggles, to repaint charts with new colors. */
window.redrawCharts = function () {
  if (_chartsGeojson) {
    // Refresh histogram color stops for the active mode using the new dark/bright palette
    if (typeof window.getColorStopsForMode === "function") {
      _activeColorStops = window.getColorStopsForMode(_chartsGeojson, _activeModeId);
    }
    _buildAxisSelector();        // rebuild to update --axis-color CSS vars for new mode
    _applyChart2ModeVisibility();
    _drawRadarTriangle();
    _drawHistogram();
  }
};
