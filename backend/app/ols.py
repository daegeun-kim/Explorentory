import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Expected column order of the raw arrays passed in from recommend.py.
# These indices are used by _engineer_features() to locate each column.
COL_RENT_KNN   = 0
COL_SQFT       = 1
COL_BEDROOMNUM = 2
COL_BATHROOMNUM = 3
COL_BOROCODE   = 4
COL_BUILT_YEAR = 5
COL_BLD_STORY  = 6

# Value assigned when a property's borocode does NOT match the user's neighborhood
BOROCODE_NO_MATCH = 2
# Value assigned when a property's borocode DOES match
BOROCODE_MATCH    = 1

# ---------------------------------------------------------------------------


def _engineer_features(X_raw: np.ndarray, user_prefs: dict,
                built_year_ref: float, bld_story_ref: float) -> np.ndarray:
    """
    Transform raw feature columns into engineered features.

    Raw columns (COL_* indices above):
        rent_knn, sqft, bedroomnum, bathroomnum, borocode, built_year, bld_story

    Engineered output columns (in order):
        rent_knn         — as-is
        sqft             — as-is
        bedroomnum_diff  — |bedroomnum  - user_bedrooms|
        bathroomnum_diff — |bathroomnum - user_bathrooms|
        borocode_match   — BOROCODE_MATCH if same borough, else BOROCODE_NO_MATCH
        built_year_diff  — |built_year  - median_built_year_all|
        bld_story_diff   — |bld_story   - median_bld_story_all|
    """
    user_bedrooms  = float(user_prefs.get("bedrooms")  or 0)
    user_bathrooms = float(user_prefs.get("bathrooms") or 0)
    user_borocode  = user_prefs.get("neighborhood_borocode")

    rent_knn    = X_raw[:, COL_RENT_KNN]
    sqft        = X_raw[:, COL_SQFT]
    bed_diff    = np.abs(X_raw[:, COL_BEDROOMNUM]  - user_bedrooms)
    bath_diff   = np.abs(X_raw[:, COL_BATHROOMNUM] - user_bathrooms)

    if user_borocode is not None:
        boro_match = np.where(
            X_raw[:, COL_BOROCODE] == float(user_borocode),
            BOROCODE_MATCH,
            BOROCODE_NO_MATCH,
        ).astype(float)
    else:
        boro_match = np.full(len(X_raw), BOROCODE_NO_MATCH, dtype=float)

    yr_diff    = np.abs(X_raw[:, COL_BUILT_YEAR] - built_year_ref)
    story_diff = np.abs(X_raw[:, COL_BLD_STORY]  - bld_story_ref)

    return np.column_stack([
        rent_knn, sqft, bed_diff, bath_diff, boro_match, yr_diff, story_diff,
    ])


def train_and_predict(
    X_train_raw: np.ndarray,
    y_train: np.ndarray,
    X_all_raw: np.ndarray,
    user_prefs: dict = None,
) -> np.ndarray:
    """
    Feature-engineer, scale, and fit an OLS regressor on the user-rated samples,
    then return predicted scores for every row in X_all_raw.

    Parameters
    ----------
    X_train_raw : (n_samples, 7)  raw feature matrix for rated properties
    y_train     : (n_samples,)    user ratings (0–10)
    X_all_raw   : (n_total,  7)   raw feature matrix for all filtered properties
    user_prefs  : dict with keys  bedrooms (int), bathrooms (int),
                            neighborhood_borocode (int | None)

    Returns
    -------
    predictions : (n_total,)  predicted scores for every property
    """
    if user_prefs is None:
        user_prefs = {}

    print(f"[ols] raw X_train shape: {X_train_raw.shape}  y_train: {y_train.tolist()}")
    print(f"[ols] user_prefs: {user_prefs}")

    # Reference values for features without explicit user preferences:
    # use the median across ALL filtered properties so the scaler has
    # a meaningful centre even with only 10 training samples.
    built_year_ref = float(np.median(X_all_raw[:, COL_BUILT_YEAR]))
    bld_story_ref  = float(np.median(X_all_raw[:, COL_BLD_STORY]))
    print(f"[ols] reference values  built_year_ref={built_year_ref:.1f}  bld_story_ref={bld_story_ref:.2f}")

    # Feature engineering
    X_train_eng = _engineer_features(X_train_raw, user_prefs, built_year_ref, bld_story_ref)
    X_all_eng   = _engineer_features(X_all_raw,   user_prefs, built_year_ref, bld_story_ref)
    print(f"[ols] engineered X_train shape: {X_train_eng.shape}")

    # StandardScaler — fit on the full dataset for a stable scale estimate
    scaler      = StandardScaler()
    X_all_sc    = scaler.fit_transform(X_all_eng)
    X_train_sc  = scaler.transform(X_train_eng)
    print(f"[ols] scaling complete  means={scaler.mean_.round(3).tolist()}")

    # OLS regression
    model = LinearRegression()
    model.fit(X_train_sc, y_train)
    print(f"[ols] model fit  coef={model.coef_.round(4).tolist()}  intercept={model.intercept_:.4f}")

    predictions = model.predict(X_all_sc)
    print(f"[ols] predictions — min={float(predictions.min()):.3f}  max={float(predictions.max()):.3f}")
    return predictions
