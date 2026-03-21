import json
import traceback
import numpy as np
import pandas as pd
import warnings

from .lgbm import train_and_predict

warnings.filterwarnings("ignore")

FEATURE_COLS = [
    "rent_knn",
    "sqft",
    "livingroomnum",
    "bedroomnum",
    "bathroomnum",
    "borocode",
    "built_year",
    "bld_story",
    "elevator_int",
    "small_n_enc",
]

# Priority keys sent from frontend and their scoring direction.
# rent:     lower  is better → score = (max - val) / range
# distance: closer is better → score = (max - val) / range
# sqft:     larger is better → score = (val - min) / range
_SCORE_DIRECTION = {
    "rent":     "lower",
    "location": "lower",   # "location" from frontend maps to "distance" column
    "sqft":     "higher",
}

# Frontend key → gdf column name
_KEY_TO_COL = {
    "rent":     "rent_knn",
    "location": "distance",
    "sqft":     "sqft",
}


def _minmax_score(series, direction):
    """Return a [0, 1] score series. direction='lower' means lower values get score 1."""
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


def run_recommendation(gdf, ratings, priority_order=None):
    """
    Orchestrates recommendation:
    1. Preprocess the full filtered GeoDataFrame.
    2. Build X_train / y_train from the 10 user-rated samples.
    3. Train LightGBM and get predicted_score.
    4. Compute rule-based score from rent, distance, sqft with priority weights.
    5. Normalize ML score to [0, 1].
    6. final_score = (rule_score + ml_score_normalized) / 2.
    7. Return the top-1000 properties (unique BIN) as GeoJSON.
    """
    try:
        if not ratings:
            print("[recommend] no ratings provided")
            return {"geojson": None, "error": "No ratings provided."}

        print(f"[recommend] starting — {len(gdf)} total properties, {len(ratings)} rated samples")
        print(f"[recommend] priority_order={priority_order}")
        gdf = gdf.copy()

        # --- Reproject to WGS84 ---
        if gdf.crs is None:
            print("[recommend] CRS not set — assuming EPSG:2263, reprojecting to EPSG:4326")
            gdf = gdf.set_crs("EPSG:2263")
        gdf = gdf.to_crs("EPSG:4326")
        print("[recommend] reprojected to EPSG:4326")

        # --- Encode elevator as int ---
        gdf["elevator_int"] = gdf["elevator"].fillna(False).astype(int)

        # --- Encode small_n as integer category (fit on full dataset) ---
        all_small_n = gdf["small_n"].fillna("unknown").astype(str)
        categories  = sorted(all_small_n.unique().tolist())
        cat_map     = {cat: i for i, cat in enumerate(categories)}
        gdf["small_n_enc"] = all_small_n.map(cat_map).fillna(-1).astype(int)
        print(f"[recommend] encoded small_n — {len(categories)} unique neighborhoods")

        # --- Numeric columns: coerce and fill ---
        num_cols = [
            "rent_knn", "sqft", "livingroomnum", "bedroomnum",
            "bathroomnum", "borocode", "built_year", "bld_story",
        ]
        for col in num_cols:
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
            feats        = rated.features
            small_n_val  = str(feats.get("small_n") or "")
            enc          = cat_map.get(small_n_val, -1)
            elevator_val = int(bool(feats.get("elevator", False)))

            row = [
                float(feats.get("rent_knn")     or 0),
                float(feats.get("sqft")          or 0),
                float(feats.get("livingroomnum") or 0),
                float(feats.get("bedroomnum")    or 0),
                float(feats.get("bathroomnum")   or 0),
                float(feats.get("borocode")      or 0),
                float(feats.get("built_year")    or 0),
                float(feats.get("bld_story")     or 0),
                float(elevator_val),
                float(enc),
            ]
            X_train_rows.append(row)
            y_train_list.append(float(rated.rating))

        X_train = np.array(X_train_rows, dtype=float)
        y_train = np.array(y_train_list, dtype=float)
        print(f"[recommend] X_train shape: {X_train.shape}")

        # --- Train LightGBM and predict (delegated to lgbm.py) ---
        predicted_scores = train_and_predict(X_train, y_train, X_all)
        gdf["predicted_score"] = predicted_scores
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
        # Default order if not provided: rent (1st), location (2nd), sqft (3rd)
        if not priority_order or len(priority_order) < 3:
            print("[recommend] no valid priority_order — using default: rent, location, sqft")
            priority_order = ["rent", "location", "sqft"]

        weights = {priority_order[0]: 3, priority_order[1]: 2, priority_order[2]: 1}
        print(f"[recommend] priority weights: {weights}")

        weighted_sum   = pd.Series(0.0, index=gdf.index)
        total_weight   = 0

        for key, weight in weights.items():
            col = _KEY_TO_COL.get(key)
            if col is None or col not in gdf.columns:
                print(f"[recommend] skipping unknown priority key '{key}'")
                continue
            direction = _SCORE_DIRECTION[key]
            feature_score = _minmax_score(gdf[col].astype(float), direction)
            weighted_sum += weight * feature_score
            total_weight += weight
            print(f"[recommend] feature '{key}' (col='{col}', dir={direction}, w={weight})  score range [{feature_score.min():.4f}, {feature_score.max():.4f}]")

        gdf["rule_score"] = weighted_sum / total_weight if total_weight > 0 else 0.5
        print(f"[recommend] rule_score range: [{gdf['rule_score'].min():.4f}, {gdf['rule_score'].max():.4f}]")

        # --- Final score: average of rule-based and normalized ML score ---
        gdf["final_score"] = (gdf["rule_score"] + gdf["ml_score"]) / 2
        print(f"[recommend] final_score range: [{gdf['final_score'].min():.4f}, {gdf['final_score'].max():.4f}]")

        # --- Select top 1000 with unique BIN (one unit per building) ---
        gdf_sorted     = gdf.sort_values("final_score", ascending=False)
        gdf_unique_bin = gdf_sorted.drop_duplicates(subset=["bin"], keep="first")
        n_top          = min(1000, len(gdf_unique_bin))
        top            = gdf_unique_bin.head(n_top).copy()
        print(f"[recommend] {len(gdf_sorted)} scored → {len(gdf_unique_bin)} unique BINs → top {len(top)}")

        geojson = json.loads(top.to_json())
        print(f"[recommend] serialized to GeoJSON — {len(geojson.get('features', []))} features")
        return {"geojson": geojson, "error": None}

    except Exception as e:
        print(f"[recommend] exception: {e}")
        traceback.print_exc()
        return {"geojson": None, "error": str(e)}
