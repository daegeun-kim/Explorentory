import numpy as np
import lightgbm as lgb


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
        n_estimators=100,
        num_leaves=15,
        min_child_samples=1,
        verbose=-1,
    )
    model.fit(X_train, y_train)
    print("[lgbm] model training complete")

    predictions = model.predict(X_all)
    print(f"[lgbm] predictions — min={float(predictions.min()):.3f}  max={float(predictions.max()):.3f}")
    return predictions
