# Explorentory — AI-Powered NYC Rental Discovery

> Replace hard constraints with weighted optimization and user-driven preference learning.

Explorentory inverts the conventional rental search paradigm. Instead of forcing users through rigid filter walls, it learns user preferences from a 10-property rating survey and ranks ~5,000 relevant properties using a hybrid rule-based + OLS regression scoring system, visualized on an interactive geospatial map with an LLM chat layer for natural language refinement.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Data Pipeline](#data-pipeline)
3. [Four-Step Application Flow](#four-step-application-flow)
4. [Backend API](#backend-api)
5. [Machine Learning Pipeline](#machine-learning-pipeline)
6. [LLM Integration](#llm-integration)
7. [Frontend Architecture](#frontend-architecture)
8. [Tech Stack](#tech-stack)
9. [Running the Project](#running-the-project)

---

## System Architecture

```
PostgreSQL/PostGIS (3M unit dataset)
        │
        ▼
FastAPI Backend  ──────────────────────────────────────────────────┐
  /neighborhoods   →  260 neighborhood polygons (GeoJSON)          │
  /properties      →  filtered sample (10 units for rating)        │
  /recommend       →  OLS + rule-based scoring → top 5,000 units   │
  /explain         →  per-property LLM narrative                   │
  /explain_result  →  OLS coefficient interpretation (LLM)         │
  /chat            →  NL → structured filter/sort JSON (LLM)       │
        │                                                           │
        ▼                                                           │
Vanilla JS Frontend                                                 │
  MapLibre GL map  ←─ GeoJSON (5,000 properties, choropleth)       │
  Canvas charts    ←─ histogram + radar triangle                    │
  Chat panel       ←────────────────────────────────────────────────┘
                        client-side filter/sort from LLM JSON
```

**Three-tier stack:** Vanilla JS frontend → FastAPI backend → PostgreSQL + PostGIS. No frontend framework; no ORM. All geospatial operations done in Python with GeoPandas/Shapely; spatial queries use raw SQL via SQLAlchemy `text()`.

---

## Data Pipeline

### 1. Source Data

| Source | Content | Scale |
|--------|---------|-------|
| NYC PLUTO | Building attributes (BIN, lot area, built year, stories, zoning, bldg_class) | ~1M buildings |
| NYC Building Footprints | Polygon geometries per building (EPSG:2263) | ~1M polygons |
| Manual scrape (seed) | Real rent values with unit type | ~105 units |
| Neighborhood list | `borocode → large_n → small_n` mapping | 260 neighborhoods |

### 2. Synthetic Unit Generation

PLUTO contains building-level records, not unit-level. Synthetic units are generated per building using probabilistic distributions by building type:

```
lowrise  (bld_story ≤ 4 OR no elevator):
  studio  8%   160–450 sqft
  1br    42%   450–700 sqft
  2br    32%   650–1,500 sqft
  3br    15%   900–2,500 sqft
  4br     3%   1,300–5,000 sqft

midrise  (5–12 stories, elevator):
  higher density, smaller unit mix

highrise (≥13 stories):
  studio/1br dominant, larger units rare
```

Output: **~3 million synthetic unit records** stored in PostgreSQL table `nyc_units`.

### 3. KNN Rent Imputation

Only ~105 buildings have real rent labels — far too sparse to filter from.

**Solution — neighborhood multiplier:**
- Assign a location multiplier per `small_n` neighborhood (e.g., Tribeca → 2.10, Soundview → 0.80)
- Train a KNN regressor: `f(multiplier, sqft, bedroomnum, bathroomnum, built_year, elevator, bld_story, bldg_class, bld_type) → rent`
- Impute `rent_knn` for all ~3M units

This is a **data completion model**, not a market prediction model. Its purpose is to produce a plausible continuous rent surface over all units so they can be filtered and ranked.

### 4. Geospatial Enrichment

Each unit is spatially enriched at build time:

| Column | Source | Method |
|--------|--------|--------|
| `dist_greenspace_ft` | NYC Parks polygons | PostGIS `ST_Distance` |
| `dist_subway_ft` | MTA station points | PostGIS `ST_Distance` |
| `dist_major_park_ft` | Major park polygons | PostGIS `ST_Distance` |
| `nearest_major_park` | Major park name | PostGIS `ST_ClosestPoint` |
| `noise_level` | NYC 311 / DOT noise grid | Spatial join, ordinal 0–4 |

All distances stored in feet (EPSG:2263 native units); no reprojection needed at build time.

---

## Four-Step Application Flow

### Step 1 — Preferences

User sets numerical constraints via modal:

| Parameter | Range | Default | Tolerance at query time |
|-----------|-------|---------|------------------------|
| Rent | $1,500–$10,000 | $3,000 | −20% to +5% (`rent_knn BETWEEN rent*0.8 AND rent*1.05`) |
| Bedrooms | 0–10 | 1 | ±1 (`BETWEEN bedrooms-1 AND bedrooms+1`) |
| Bathrooms | 0–10 | 1 | ±1 (`BETWEEN bathrooms-1 AND bathrooms+1`) |
| Priority order | rent / location / sqft | — | Drives rule-based scoring weights |
| Open concern | free text | — | Forwarded to LLM prompts |

### Step 2 — Neighborhood Selection

- 260 neighborhood polygons rendered as a MapLibre fill layer
- User clicks a polygon; centroid `(lon, lat)` and `borocode` are captured
- `GET /neighborhoods` returns all polygons from the `neighb` PostGIS table

At query time, Euclidean distance from each property's first coordinate to the neighborhood centroid is computed in Python:

```python
distance = sqrt((prop_lon - nbhd_lon)² + (prop_lat - nbhd_lat)²)
```

Distance is computed in EPSG:4326 degrees (fast, sufficient for relative ranking within a city-scale area) and stored as `gdf["distance"]` passed into the recommendation engine.

### Step 3 — Property Rating Survey

`POST /properties` runs the SQL filter (rent ± tolerance, bed/bath ± 1) and returns 10 sample properties for user rating.

**Sampling strategy** (`db.py`):
- If `borocode` is known: guarantee at least 5 samples from the same borough (`MIN_SAME_BORO_SAMPLES = 5`), fill remaining from other boroughs — ensures the user sees locally relevant examples
- If no borocode: random sample with seed 42

Each card shows: neighborhood, rent, sqft, bedrooms, bathrooms. User enters a score 0–10 per property (clamped in real time on input). These 10 `(features, rating)` pairs become the ML training set.

### Step 4 — Results & LLM Refinement

`POST /recommend` re-runs the same SQL filter (now to get the full `gdf`, not just 10 samples), runs the ML + scoring pipeline, and returns top-5,000 properties as GeoJSON.

Results are displayed as:
- MapLibre choropleth layer (10 switchable dimensions)
- Ranked top-10 listing cards (scrollable)
- Histogram and radar chart (canvas-based)
- Chat panel for LLM-driven filter/sort refinement

---

## Backend API

All endpoints defined in `backend/app/__init__.py`. CORS is fully open (`allow_origins=["*"]`).

### `GET /neighborhoods`
Returns all rows from `neighb` table as GeoJSON FeatureCollection. Each feature has centroid properties added server-side for frontend use.

### `POST /properties`
**Input:** `Preferences` (rent, bedrooms, bathrooms, neighborhood_lon, neighborhood_lat, neighborhood_borocode)

**Logic (`db.py: get_filtered_properties`):**
1. Build parameterized SQL with rent/bed/bath tolerances
2. `gpd.read_postgis()` → GeoDataFrame in EPSG:2263
3. Reproject to EPSG:4326
4. Compute `distance` column (Euclidean from neighborhood centroid)
5. Borough-stratified sample of 10 properties
6. Serialize sample as list of dicts (geometry as GeoJSON `mapping`)

**Output:** `{ sample: [...10 property dicts...], error: null }`

### `POST /recommend`
**Input:** `RecommendPayload` (preferences + list of `RatedProperty{features, rating}`)

**Logic:**
1. `get_filtered_properties()` → full `gdf` (not sampled)
2. `run_recommendation(gdf, ratings, priority_order, user_prefs)` → GeoJSON + OLS coefficients

**Output:** `{ geojson: FeatureCollection, ols_coef: {feature: coef}, error: null }`

### `POST /explain`
Calls `explain_property(user_prefs, property_info)` → 2–3 sentence LLM narrative.

### `POST /explain_result`
Calls `explain_result(user_prefs, priority_order, ols_coef, neighborhood, concern)` → 2–4 sentence plain-English interpretation of what the model learned.

### `POST /chat`
Calls `chat_query(message, history)` → structured JSON `{filters, sort, logic, message}` applied client-side.

---

## Machine Learning Pipeline

All ML logic lives in `backend/app/recommend.py` and `backend/app/ols.py`.

### Feature Engineering (`ols.py: _engineer_features`)

Raw input columns (11) → engineered columns (11):

| Raw | Engineered | Transform |
|-----|-----------|-----------|
| `rent_knn` | `rent_knn` | as-is |
| `sqft` | `sqft` | as-is |
| `bedroomnum` | `bedroomnum_diff` | `abs(bedroomnum - user_bedrooms)` |
| `bathroomnum` | `bathroomnum_diff` | `abs(bathroomnum - user_bathrooms)` |
| `borocode` | `borocode_match` | 1 if same borough as selection, else 2 |
| `built_year` | `built_year_diff` | `abs(built_year - median_built_year_all)` |
| `bld_story` | `bld_story_diff` | `abs(bld_story - median_bld_story_all)` |
| `elevator` | `elevator` | 0 or 1 |
| `dist_greenspace_ft` | `dist_greenspace_ft` | as-is |
| `dist_subway_ft` | `dist_subway_ft` | as-is |
| `noise_level_ord` | `noise_level_ord` | ordinal 0–4 (very low → very high) |

**Reference values** (`built_year_ref`, `bld_story_ref`) use the **median of the full filtered dataset**, not the 10 training samples — this prevents the reference from being distorted by small-sample bias.

### Scaling

`StandardScaler` is **fit on all ~N filtered properties** (`X_all`), then `transform` is applied to both `X_all` and the 10 training samples (`X_train`). Fitting on the full population gives stable scale estimates even with only 10 training points.

```python
scaler   = StandardScaler()
X_all_sc    = scaler.fit_transform(X_all_eng)   # fit on full set
X_train_sc  = scaler.transform(X_train_eng)     # apply same scale to training
```

### OLS Regression

```python
model = LinearRegression()
model.fit(X_train_sc, y_train)   # 10 samples, ratings 0–10
predictions = model.predict(X_all_sc)   # scores for all ~N properties
```

Coefficients are returned as a named dict (`coef_dict`) for downstream LLM interpretation.

### Rule-Based Scoring

Three features with user-defined priority order (weights 3 / 2 / 1):

```python
PRIORITY_WEIGHTS    = [3, 2, 1]           # 1st / 2nd / 3rd priority
PRIORITY_KEY_TO_COL = { rent: rent_knn, location: distance, sqft: sqft }
SCORE_DIRECTION     = { rent: lower, location: lower, sqft: higher }

# Min-max normalization per direction
rule_score = Σ(weight_i × minmax_score(col_i)) / Σ(weight_i)
```

### Hybrid Final Score

```python
ml_score   = normalize(predicted_scores, to=[0, 1])
final_score = (rule_score + ml_score) / 2
```

Equal weighting between explicit user priorities (rule) and latent preferences inferred from ratings (ML).

### Output Selection

```python
TOP_N = 5000
gdf_sorted     = gdf.sort_values("final_score", ascending=False)
gdf_unique_bin = gdf_sorted.drop_duplicates(subset=["bin"], keep="first")
top            = gdf_unique_bin.head(TOP_N)
```

Deduplication on `bin` (Building Identification Number) ensures one unit per building in the output.

---

## LLM Integration

All LLM logic lives in `backend/app/llm/`. Model: `gpt-5-nano` via OpenAI Responses API (`client.responses.create`).

### Three Endpoints

#### `explain_property` → `/explain`
Called per-property when the user clicks "Explain". Receives user preferences + property attributes. Returns a 2–3 sentence narrative explaining why this property matches (or doesn't match) the user's criteria.

#### `explain_result` → `/explain_result`
Called once after recommendations load. Receives the 11 OLS coefficients + user priorities + neighborhood + open concern. Prompt instructs the model to:
- Describe which features drove the recommendations in plain English
- Mention top 3–4 influential features without citing raw numbers
- Stay within 2–4 sentences

#### `chat_query` → `/chat`
**Natural language → structured filter/sort JSON** applied entirely client-side.

System prompt (`CHAT_SYSTEM_PROMPT`) provides:
- Column schema with types and value ranges (compact table format)
- Common intents (filter by rent, noise, elevator, distance, neighborhood, building type)
- Regional mapping: neighborhood names → `large_n` district labels (for borough-level filtering)
- Building type codes: `bldg_class` A/B/C/D → residential categories
- Required response format:
```json
{
  "filters": [{"column": "...", "op": "<=", "value": ...}],
  "sort":    [{"by": "...", "order": "asc|desc"}],
  "logic":   "AND|OR",
  "message": "plain English summary of what was applied"
}
```

Multi-turn conversation is supported: `_chatHistory` array of `{role, content}` is sent with each request. Filter/sort operations are applied to the client-held GeoJSON (`_currentGeojson`) — no re-query to the backend — keeping latency near-zero after the initial recommendation load.

**Client-side application (`main.js: _applyChatResult`):**
1. Filter `_currentGeojson.features` with AND/OR logic across all filter conditions
2. Sort remaining features by specified columns
3. Push filtered GeoJSON to map (`window.updateRecommendationData`)
4. Re-initialize charts (`window.initCharts`) — resets histogram to `final_score` view and map choropleth to `score` mode
5. Refresh top-10 listing cards

A **Reset** button restores `_currentGeojson` and clears `_chatHistory`.

---

## Frontend Architecture

All frontend code is vanilla JavaScript (no framework). Six modules loaded in order via `<script>` tags.

### Module Responsibilities

| File | Lines | Responsibility |
|------|-------|---------------|
| `map.js` | 1,289 | MapLibre GL init, choropleth rendering, neighborhood + survey + recommendation layers, pin markers |
| `charts.js` | 1,023 | Canvas histogram (chart1), canvas radar triangle (chart2), mode switching, axis selector |
| `main.js` | 855 | App orchestration, 4-step state machine, LLM chat panel, resize handles, dark/bright mode |
| `preferences.js` | 168 | Step 1 modal — rent slider, room inputs, priority ranking, concern text |
| `rating.js` | 188 | Step 3 survey — 10 rating cards, score clamping, submit |
| `neighborhood.js` | 47 | Step 2 sidebar — confirm button, receives selection events from map.js |

### Map Layer System (`map.js`)

MapLibre GL v3.6.1. Three geometry modes:
- **Circle layer** (`propCircleId`) — low zoom, centroid points
- **Fill layer** (`propFillId`) — mid zoom, building footprint polygons
- **Extrusion layer** (`propExtId`) — high zoom, 3D extruded buildings (height from `heightroof`)

**10 choropleth dimensions:**

| Mode ID | Column | Color ramp |
|---------|--------|------------|
| `score` | `final_score` | blue → green → yellow |
| `rent` | `rent_knn` | green → yellow → red |
| `sqft` | `sqft` | purple → blue → cyan |
| `built_year` | `built_year` | red → orange → yellow |
| `stories` | `bld_story` | blue → purple |
| `elevator` | `elevator` | binary |
| `park` | `dist_major_park_ft` | green → yellow → red |
| `greenspace` | `dist_greenspace_ft` | green → yellow → red |
| `subway` | `dist_subway_ft` | blue → yellow → red |
| `noise` | `noise_level_ord` | green → yellow → red |

Each mode has independent dark and bright color pairs. Mode selection triggers `updateChoroplethMode()` which updates all three layer paint properties and notifies `charts.js` via `window.onChoroplethModeChange()` to synchronize the histogram.

Basemap: `style.json` (dark) / `style_bright.json` (bright), swapped by `toggleMapStyle()`.

### Chart System (`charts.js`)

**Chart 1 — Histogram (canvas)**
- Renders distribution of all currently active properties for the selected dimension
- Bin widths: `$10` (rent), `50 sqft`, `5 years` (built year), `1` (stories/ordinal), `50 ft` (subway/greenspace distances), `span/50` (final score, park distance)
- Red marker line shows the selected property's value
- Click on a bar filters the map to that bin range; click above a bar clears the filter
- Synchronized with choropleth mode — switching map dimension also switches histogram column

**Chart 2 — Radar Triangle (canvas)**
- 3–6 configurable axes from the pool: Rent, Location, Sqft, Subway Distance, Green Space Distance, Noise Comfort
- Axis selector (right column) built dynamically with colored toggle buttons
- Radar polygon filled at 50% opacity; each vertex colored by axis

**ResizeObserver** on `#input-output` toggles `.wide` class on the listing container, switching to a 2-column CSS grid when sidebar width ≥ 800px.

### Layout & Resize Handles

Three drag handles implemented with the same pattern (mousedown → mousemove delta → explicit px heights):

| Handle | Element | Controls |
|--------|---------|---------|
| `#chart-resize-handle` | Vertical | map height vs. chart height |
| `#sidebar-resize-handle` | Horizontal | main map+chart width vs. sidebar width |
| `#listing-chat-handle` | Vertical (dynamic) | listing height vs. LLM chat height |

`#output-message` uses `gap: 0` with JS-controlled explicit pixel heights so CSS percentage heights never interfere with the drag calculations.

### State Machine (`main.js`)

Global state:

```js
currentPreferences   // user inputs from step 1 + step 2
_currentGeojson      // full recommendation GeoJSON from /recommend
_activeGeojson       // currently displayed (may be chat-filtered)
_currentOlsCoef      // OLS coefficients from /recommend
_chatHistory         // [{role, content}] multi-turn LLM history
```

4-step progress bar rendered into `#stage-bar` above `#output-message`. Each step transition is driven by `window.on*Submit` callbacks across module boundaries.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES6+), MapLibre GL 3.6.1, Canvas API, CSS custom properties |
| Backend | Python 3.12, FastAPI 0.121.2, Uvicorn 0.38 |
| Database | PostgreSQL 16, PostGIS (spatial extension) |
| ML | scikit-learn (LinearRegression, StandardScaler), NumPy, Pandas |
| Geospatial | GeoPandas 1.1.1, Shapely, SQLAlchemy |
| LLM | OpenAI API (gpt-5-nano), Responses API |
| Data Sources | NYC PLUTO, NYC Building Footprints, MTA stations, NYC Parks, 311 noise data |

---

## Running the Project

### Backend

```bash
cd backend
poetry install
uvicorn backend.app:app --reload --port 8000
```

Requires a `.env` file at the project root:

```
OPENAI_API_KEY=sk-...
db_url=postgresql://user:password@host:port/dbname
```

The database must have the `nyc_units` (property records) and `neighb` (neighborhood polygons) tables populated.

### Frontend

Open `frontend/index.html` via a local server (e.g., VS Code Live Server on port 5501). The backend must be running on `http://localhost:8000`.

---

## Key Design Decisions

**Why OLS instead of a more complex model?**
Training set is only 10 samples per session. OLS with StandardScaler and engineered features generalizes better at this sample size than tree-based or neural models, which would overfit immediately.

**Why client-side LLM filter application?**
Sending 5,000-property GeoJSON to the backend on every chat turn would be slow and expensive. Instead, the LLM generates a lightweight JSON action (filters + sort), and the client applies it to the cached `_currentGeojson` — near-zero latency after initial load.

**Why StandardScaler fit on full dataset?**
Fitting only on the 10 rated training samples would produce an unstable scale estimate. Fitting on all ~N filtered properties gives the scaler a stable mean/variance, preventing any single outlier-rated property from distorting the scale for the entire dataset.

**Why hybrid scoring?**
Rule-based scoring honors explicit user priorities (rent, location, sqft) which users consciously state. OLS captures implicit preferences revealed through the rating behavior. Averaging both prevents the ML from completely overriding stated priorities when the regression signal is weak.
