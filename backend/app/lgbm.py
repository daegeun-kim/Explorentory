import numpy as np
import lightgbm as lgb

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

N_ESTIMATORS     = 100   # number of boosting rounds
NUM_LEAVES       = 15    # max leaves per tree
MIN_CHILD_SAMPLES = 1    # minimum samples in a leaf (low because training set is only ~10)
VERBOSE          = -1    # suppress LightGBM training output

# ---------------------------------------------------------------------------


def train_and_predict(X_train: np.ndarray, y_train: np.ndarray, X_all: np.ndarray) -> np.ndarray:
    """
    Train a LightGBM regressor on the user-rated samples and return
    predicted scores for every row in X_all.

    Parameters
    ----------
    X_train : (n_samples, n_features)  feature matrix for rated properties
    y_train : (n_samples,)             user ratings (0–10)
    X_all   : (n_total, n_features)    feature matrix for all filtered properties

    Returns
    -------
    predictions : (n_total,)  predicted scores for every property
    """
    print(f"[lgbm] training set shape: {X_train.shape}  y_train: {y_train.tolist()}")

    model = lgb.LGBMRegressor(
        n_estimators=N_ESTIMATORS,
        num_leaves=NUM_LEAVES,
        min_child_samples=MIN_CHILD_SAMPLES,
        verbose=VERBOSE,
    )
    model.fit(X_train, y_train)
    print("[lgbm] model training complete")

    predictions = model.predict(X_all)
    print(f"[lgbm] predictions — min={float(predictions.min()):.3f}  max={float(predictions.max()):.3f}")
    return predictions
