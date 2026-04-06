import json
import time
import traceback
import numpy as np
import pandas as pd
import warnings

from .ols import train_and_predict

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Raw feature columns extracted from gdf and passed to ols.py.
# Order must match the COL_* index constants defined in ols.py.
FEATURE_COLS = [
    "rent_knn",
    "sqft",
    "bedroomnum",
    "bathroomnum",
    "borocode",
    "built_year",
    "bld_story",
    "elevator",
    "dist_greenspace_ft",
    "dist_subway_ft",
    "noise_level_ord",   # ordinal-encoded from noise_level string
]

# Mapping from noise_level string → ordinal integer
NOISE_LEVEL_MAP = {
    "very low": 0,
    "low":      1,
    "medium":   2,
    "high":     3,
    "very high": 4,
}

# Top N recommendations to return (unique BIN)
TOP_N = 3000

# Priority weights: index 0 = 1st priority, index 1 = 2nd, index 2 = 3rd
PRIORITY_WEIGHTS = [3, 2, 1]

# Default priority order if the frontend sends none
DEFAULT_PRIORITY_ORDER = ["rent", "location", "sqft"]

# Rule-based scoring direction per feature key
# "lower" → lower values score higher (closer to 1)
# "higher" → higher values score higher (closer to 1)
SCORE_DIRECTION = {
    "rent":     "lower",
    "location": "lower",   # "location" from frontend = distance column
    "sqft":     "higher",
}

# Mapping from frontend priority key → gdf column name
PRIORITY_KEY_TO_COL = {
    "rent":     "rent_knn",
    "location": "distance",
    "sqft":     "sqft",
}

# ---------------------------------------------------------------------------


def _minmax_score(series, direction):
    mn = series.min()
    mx = series.max()
    rng = mx - mn
    if rng == 0:
        print("[recommend] score column has zero range — returning 0.5 for all")
        return pd.Series(0.5, index=series.index)
    if direction == "lower":
        return (mx - series) / rng
    else:
        return (series - mn) / rng


def run_recommendation(gdf, ratings, priority_order=None, user_prefs=None):
    """
    Orchestrates recommendation:
    1. Preprocess the full filtered GeoDataFrame.
    2. Build X_train / y_train from the user-rated samples.
    3. OLS regression via ols.py (feature engineering + StandardScaler inside).
    4. Compute rule-based score from rent, distance, sqft with priority weights.
    5. Normalize ML score to [0, 1].
    6. final_score = (rule_score + ml_score_normalized) / 2.
    7. Return the top TOP_N properties (unique BIN) as GeoJSON.

    user_prefs : dict with keys bedrooms, bathrooms, neighborhood_borocode
    """
    try:
        if not ratings:
            print("[recommend] no ratings provided")
            return {"geojson": None, "error": "No ratings provided."}

        if user_prefs is None:
            user_prefs = {}

        _t_start = time.perf_counter()
        print(f"[recommend] starting — {len(gdf)} total properties, {len(ratings)} rated samples")
        print(f"[recommend] priority_order={priority_order}  user_prefs={user_prefs}")
        gdf = gdf.copy()

        # --- Reproject to WGS84 ---
        if gdf.crs is None:
            print("[recommend] CRS not set — assuming EPSG:2263, reprojecting to EPSG:4326")
            gdf = gdf.set_crs("EPSG:2263")
        gdf = gdf.to_crs("EPSG:4326")
        print("[recommend] reprojected to EPSG:4326")

        # --- Encode categorical noise_level → ordinal before numeric coercion ---
        if "noise_level" in gdf.columns:
            gdf["noise_level_ord"] = (
                gdf["noise_level"].astype(str).str.lower().str.strip()
                .map(NOISE_LEVEL_MAP)
                .fillna(2)   # default: medium
            )
        else:
            gdf["noise_level_ord"] = 2.0

        # --- Coerce numeric feature columns ---
        for col in FEATURE_COLS:
            gdf[col] = pd.to_numeric(gdf[col], errors="coerce").fillna(0)

        # Ensure distance column exists
        if "distance" not in gdf.columns:
            print("[recommend] distance column missing — setting to 0")
            gdf["distance"] = 0.0
        else:
            gdf["distance"] = pd.to_numeric(gdf["distance"], errors="coerce").fillna(0.0)
        print(f"[recommend] distance stats  min={gdf['distance'].min():.6f}  max={gdf['distance'].max():.6f}")

        X_all = gdf[FEATURE_COLS].values.astype(float)
        print(f"[recommend] feature matrix X_all shape: {X_all.shape}")

        # --- Build X_train / y_train from user-rated samples ---
        X_train_rows = []
        y_train_list = []

        for rated in ratings:
            feats = rated.features
            noise_str = str(feats.get("noise_level") or "medium").lower().strip()
            noise_ord = float(NOISE_LEVEL_MAP.get(noise_str, 2))
            row = [
                float(feats.get("rent_knn")          or 0),
                float(feats.get("sqft")               or 0),
                float(feats.get("bedroomnum")         or 0),
                float(feats.get("bathroomnum")        or 0),
                float(feats.get("borocode")           or 0),
                float(feats.get("built_year")         or 0),
                float(feats.get("bld_story")          or 0),
                float(bool(feats.get("elevator"))),
                float(feats.get("dist_greenspace_ft") or 0),
                float(feats.get("dist_subway_ft")     or 0),
                noise_ord,
            ]
            X_train_rows.append(row)
            y_train_list.append(float(rated.rating))

        X_train = np.array(X_train_rows, dtype=float)
        y_train = np.array(y_train_list, dtype=float)
        print(f"[recommend] X_train shape: {X_train.shape}")

        # --- OLS: feature engineering + scaling + fit + predict (all in ols.py) ---
        _t_ols = time.perf_counter()
        predicted_scores = train_and_predict(X_train, y_train, X_all, user_prefs)
        gdf["predicted_score"] = predicted_scores
        print(f"[recommend] OLS train+predict: {time.perf_counter()-_t_ols:.3f}s")
        print(f"[recommend] predicted_score stats  min={gdf['predicted_score'].min():.4f}  max={gdf['predicted_score'].max():.4f}")

        # --- Normalize ML score to [0, 1] ---
        ml_min = gdf["predicted_score"].min()
        ml_max = gdf["predicted_score"].max()
        ml_rng = ml_max - ml_min
        if ml_rng == 0:
            gdf["ml_score"] = 0.5
            print("[recommend] ML score range is zero — ml_score set to 0.5")
        else:
            gdf["ml_score"] = (gdf["predicted_score"] - ml_min) / ml_rng
        print(f"[recommend] ml_score range: [{gdf['ml_score'].min():.4f}, {gdf['ml_score'].max():.4f}]")

        # --- Rule-based score with priority weights ---
        if not priority_order or len(priority_order) < 3:
            print(f"[recommend] no valid priority_order — using default: {DEFAULT_PRIORITY_ORDER}")
            priority_order = DEFAULT_PRIORITY_ORDER

        weighted_sum = pd.Series(0.0, index=gdf.index)
        total_weight = 0

        for rank, key in enumerate(priority_order):
            weight    = PRIORITY_WEIGHTS[rank]
            col       = PRIORITY_KEY_TO_COL.get(key)
            direction = SCORE_DIRECTION.get(key)
            if col is None or col not in gdf.columns or direction is None:
                print(f"[recommend] skipping unknown priority key '{key}'")
                continue
            feature_score = _minmax_score(gdf[col].astype(float), direction)
            weighted_sum += weight * feature_score
            total_weight += weight
            print(f"[recommend] feature '{key}' (col='{col}', dir={direction}, w={weight})  score range [{feature_score.min():.4f}, {feature_score.max():.4f}]")

        gdf["rule_score"] = weighted_sum / total_weight if total_weight > 0 else 0.5
        print(f"[recommend] rule_score range: [{gdf['rule_score'].min():.4f}, {gdf['rule_score'].max():.4f}]")

        # --- Final score: average of rule-based and normalized ML score ---
        gdf["final_score"] = (gdf["rule_score"] + gdf["ml_score"]) / 2
        print(f"[recommend] final_score range: [{gdf['final_score'].min():.4f}, {gdf['final_score'].max():.4f}]")

        # --- Select top TOP_N with unique BIN (one unit per building) ---
        gdf_sorted     = gdf.sort_values("final_score", ascending=False)
        gdf_unique_bin = gdf_sorted.drop_duplicates(subset=["bin"], keep="first")
        n_top          = min(TOP_N, len(gdf_unique_bin))
        top            = gdf_unique_bin.head(n_top).copy()
        print(f"[recommend] {len(gdf_sorted)} scored → {len(gdf_unique_bin)} unique BINs → top {len(top)}")

        # Add centroid lon/lat so the frontend can render circles at low zoom
        top["centroid_lon"] = top.geometry.centroid.x
        top["centroid_lat"] = top.geometry.centroid.y

        _t_serial = time.perf_counter()
        geojson = json.loads(top.to_json())
        print(f"[recommend] GeoJSON serialization: {time.perf_counter()-_t_serial:.3f}s")
        print(f"[recommend] serialized to GeoJSON — {len(geojson.get('features', []))} features")
        print(f"[recommend] run_recommendation total: {time.perf_counter()-_t_start:.3f}s")
        return {"geojson": geojson, "error": None}

    except Exception as e:
        print(f"[recommend] exception: {e}")
        traceback.print_exc()
        return {"geojson": None, "error": str(e)}
