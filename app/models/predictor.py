"""
Demand Prediction Engine with Out-of-Sample Evaluation, Versioning & Rollback
=============================================================================
Addresses Reqs:
  #6:  Predict upcoming demand with dual output (baseline vs event uplift)
  #9:  Festival & promotion separation
  #14: Out-of-sample time-series evaluation (MAE, RMSE on held-out temporal slice)
       before deployment + acceptance validation gate
  #15: Model versioning & rollback capability
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, root_mean_squared_error
from datetime import datetime, timedelta
import joblib
import json
import uuid
import os
from app.config import get_config
from app.utils.logger import logger
from app import db

FEATURE_COLS_NUMERIC = ["is_weekend", "salary_period", "is_festival", "promotion",
                         "day_of_week", "month", "roll7_avg", "roll14_avg"]
CATEGORICAL_COLS = ["category", "weather"]


def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df["is_weekend"] = (df["day_type"] == "Weekend").astype(int)
    df["is_festival"] = (df["festival_event"].astype(str).str.len() > 0).astype(int)
    df["day_of_week"] = df["date"].dt.dayofweek
    df["month"] = df["date"].dt.month
    
    sort_cols = ["store_id", "product_id", "date"] if "store_id" in df.columns else ["product_id", "date"]
    group_cols = ["store_id", "product_id"] if "store_id" in df.columns else "product_id"
    df = df.sort_values(sort_cols)

    # Lag / rolling features per product (and store if present)
    df["roll7_avg"] = (
        df.groupby(group_cols)["quantity_sold"]
        .transform(lambda s: s.shift(1).rolling(7, min_periods=1).mean())
    )
    df["roll14_avg"] = (
        df.groupby(group_cols)["quantity_sold"]
        .transform(lambda s: s.shift(1).rolling(14, min_periods=1).mean())
    )
    df["roll7_avg"] = df["roll7_avg"].fillna(df["quantity_sold"].median() if not df.empty else 0)
    df["roll14_avg"] = df["roll14_avg"].fillna(df["quantity_sold"].median() if not df.empty else 0)
    return df


def _detect_anomalies_and_censored(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    group_cols = ["store_id", "product_id"] if "store_id" in df.columns else "product_id"

    # Statistical one-day abnormal sales detection (z-score per product), excluding known-event days
    def flag_outliers(g):
        mu, sigma = g["quantity_sold"].mean(), g["quantity_sold"].std(ddof=0)
        sigma = sigma if sigma > 1e-6 else 1.0
        z = (g["quantity_sold"] - mu) / sigma
        g["is_statistical_anomaly"] = ((z.abs() > 3) & (g["is_festival"] == 0) & (g["promotion"] == 0)).astype(int)
        return g

    df = df.groupby(group_cols, group_keys=False)[df.columns].apply(flag_outliers)

    # Stock-out / censored-demand detection: recorded stock hit (near) zero same day
    df["is_censored_demand"] = (df["current_stock"] <= 0).astype(int)
    return df


def build_training_frame(clean_df: pd.DataFrame):
    df = _engineer_features(clean_df)
    df = _detect_anomalies_and_censored(df)

    exclude_mask = (
        (df.get("is_missing_filled", 0) == 1) |
        (df["is_statistical_anomaly"] == 1) |
        (df["is_censored_demand"] == 1)
    )
    training_df = df[~exclude_mask].copy()
    excluded_df = df[exclude_mask].copy()
    return df, training_df, excluded_df


def train_and_evaluate_model(clean_df: pd.DataFrame):
    """
    Trains a model with temporal out-of-sample evaluation (Req #14) and versioning (Req #15).
    Evaluates on a held-out time slice (e.g. the last 14% of dates) to simulate real-world forecasting.
    """
    cfg = get_config()
    os.makedirs(cfg.MODEL_DIR, exist_ok=True)
    
    full_df, training_df, excluded_df = build_training_frame(clean_df)
    if training_df.empty or len(training_df) < 10:
        logger.warning("Insufficient data to train model.")
        return None, full_df, {"error": "Insufficient data (minimum 10 rows required)"}

    # Temporal split for out-of-sample evaluation (Req #14)
    unique_dates = sorted(training_df["date"].unique())
    n_dates = len(unique_dates)
    
    cat_cols = list(CATEGORICAL_COLS)
    extra_dummies = ["product_id"]
    if "store_id" in training_df.columns:
        extra_dummies.append("store_id")

    if n_dates >= 14:
        split_idx = int(n_dates * 0.85)
        cutoff_date = unique_dates[split_idx]
        train_slice = training_df[training_df["date"] < cutoff_date]
        test_slice = training_df[training_df["date"] >= cutoff_date]
    else:
        train_slice = training_df
        test_slice = training_df

    # Prepare features
    feature_source = pd.get_dummies(training_df[FEATURE_COLS_NUMERIC + cat_cols + extra_dummies],
                                     columns=cat_cols + extra_dummies)
    feature_columns = list(feature_source.columns)

    X_train = pd.get_dummies(train_slice[FEATURE_COLS_NUMERIC + cat_cols + extra_dummies],
                             columns=cat_cols + extra_dummies).reindex(columns=feature_columns, fill_value=0)
    y_train = train_slice["quantity_sold"]

    X_test = pd.get_dummies(test_slice[FEATURE_COLS_NUMERIC + cat_cols + extra_dummies],
                            columns=cat_cols + extra_dummies).reindex(columns=feature_columns, fill_value=0)
    y_test = test_slice["quantity_sold"]

    # Fit Candidate Model
    candidate_model = RandomForestRegressor(
        n_estimators=250, max_depth=10, min_samples_leaf=3, random_state=42, n_jobs=-1
    )
    candidate_model.fit(X_train, y_train)

    # Compute Out-of-Sample Metrics
    y_pred = candidate_model.predict(X_test)
    mae = float(mean_absolute_error(y_test, y_pred))
    rmse = float(root_mean_squared_error(y_test, y_pred))

    # Baseline Model & Model Validation Gate (#14)
    active_version = db.get_active_model_version()
    accepted = True
    rejection_reason = ""
    
    if active_version and active_version.get("rmse"):
        current_rmse = float(active_version["rmse"])
        if rmse > current_rmse * (1.0 + cfg.MAX_RMSE_DEGRADATION_RATIO):
            accepted = False
            rejection_reason = f"Candidate RMSE ({rmse:.2f}) degraded by more than {int(cfg.MAX_RMSE_DEGRADATION_RATIO*100)}% compared to active model ({current_rmse:.2f})."
            logger.warning(f"Model retrain rejected: {rejection_reason}")

    # Retrain on full training set if accepted
    if accepted:
        final_model = candidate_model if train_slice is training_df else RandomForestRegressor(
            n_estimators=250, max_depth=10, min_samples_leaf=3, random_state=42, n_jobs=-1
        ).fit(feature_source, training_df["quantity_sold"])
    else:
        final_model = candidate_model

    # Category fallback
    category_avg = (
        training_df.groupby(["category", "is_weekend"])["quantity_sold"].mean().to_dict()
    )

    artifact = {
        "model": final_model,
        "feature_columns": feature_columns,
        "category_avg_fallback": category_avg,
        "global_avg_fallback": float(training_df["quantity_sold"].mean()),
    }

    # Unique Versioning ID (#15)
    version_id = f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    version_filename = f"model_{version_id}.joblib"
    version_path = os.path.join(cfg.MODEL_DIR, version_filename)
    joblib.dump(artifact, version_path)

    importances = dict(sorted(
        zip(feature_columns, final_model.feature_importances_), key=lambda x: -x[1]
    )[:10])

    if accepted:
        joblib.dump(artifact, cfg.ACTIVE_MODEL_PATH)
        db.record_model_version(version_id, mae, rmse, version_path, len(training_df), json.dumps(importances), is_active=1)
        logger.info(f"Deployed new model version {version_id} with MAE={mae:.2f}, RMSE={rmse:.2f}")
    else:
        db.record_model_version(version_id, mae, rmse, version_path, len(training_df), json.dumps(importances), is_active=0)

    stats = {
        "version_id": version_id,
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "accepted": accepted,
        "rejection_reason": rejection_reason,
        "training_rows": len(training_df),
        "test_rows": len(test_slice),
        "excluded_rows": len(excluded_df),
        "excluded_missing": int(excluded_df.get("is_missing_filled", pd.Series(dtype=int)).sum()),
        "excluded_anomaly": int(excluded_df.get("is_statistical_anomaly", pd.Series(dtype=int)).sum()),
        "excluded_censored_stockout": int(excluded_df.get("is_censored_demand", pd.Series(dtype=int)).sum()),
        "feature_importance": importances,
    }
    return artifact, full_df, stats


def rollback_to_version(version_id: str):
    """Rolls back the active model to a previous version without retraining (Req #15)."""
    cfg = get_config()
    version_meta = db.set_active_model_version(version_id)
    if not version_meta:
        return None, f"Version {version_id} not found in database."

    artifact_path = version_meta["artifact_path"]
    if not os.path.exists(artifact_path):
        return None, f"Model file {artifact_path} not found on disk."

    artifact = joblib.load(artifact_path)
    joblib.dump(artifact, cfg.ACTIVE_MODEL_PATH)
    logger.info(f"Rolled back active model to version {version_id}")
    return artifact, f"Successfully rolled back to version {version_id}"


def _build_feature_row(artifact, product_row, date, is_festival, promotion, roll7, roll14, is_low_history, store_id=None):
    is_weekend = int(date.weekday() >= 5)
    salary_period = int(date.day <= 5)
    base = {
        "is_weekend": is_weekend,
        "salary_period": salary_period,
        "is_festival": int(is_festival),
        "promotion": int(promotion),
        "day_of_week": date.weekday(),
        "month": date.month,
        "roll7_avg": roll7,
        "roll14_avg": roll14,
        f"category_{product_row['category']}": 1,
        f"weather_Clear": 1,
        f"product_id_{product_row['product_id']}": 1,
    }
    if store_id:
        base[f"store_id_{store_id}"] = 1

    row = pd.DataFrame([base])
    row = row.reindex(columns=artifact["feature_columns"], fill_value=0)
    return row


def predict_horizon(artifact, full_df, product_id, horizon_days=7, upcoming_festivals=None, upcoming_promotions=None, store_id=None):
    """
    Predict demand for `horizon_days` for a product (and optional store).
    Returns both baseline and event-aware predicted demand with uplift.
    """
    upcoming_festivals = upcoming_festivals or set()
    upcoming_promotions = upcoming_promotions or set()

    subset = full_df[full_df["product_id"] == product_id]
    if store_id and store_id != "all" and "store_id" in subset.columns:
        store_subset = subset[subset["store_id"] == store_id]
        if not store_subset.empty:
            subset = store_subset

    prod_hist = subset.sort_values("date")
    if prod_hist.empty:
        return None

    product_row = prod_hist.iloc[-1]
    last_date = prod_hist["date"].max()
    history_len = len(prod_hist[prod_hist.get("is_missing_filled", 0) == 0])
    low_history = history_len < 14

    recent_sales = prod_hist[prod_hist.get("is_missing_filled", 0) == 0]["quantity_sold"]
    roll7 = float(recent_sales.tail(7).mean()) if len(recent_sales) else artifact["global_avg_fallback"]
    roll14 = float(recent_sales.tail(14).mean()) if len(recent_sales) else artifact["global_avg_fallback"]

    results = []
    model = artifact["model"]

    for i in range(1, horizon_days + 1):
        future_date = last_date + timedelta(days=i)
        date_str = future_date.strftime("%Y-%m-%d")
        has_festival = date_str in upcoming_festivals
        has_promo = date_str in upcoming_promotions

        if low_history:
            is_weekend = int(future_date.weekday() >= 5)
            base_pred = artifact["category_avg_fallback"].get(
                (product_row["category"], is_weekend), artifact["global_avg_fallback"]
            )
            baseline = base_pred
            predicted = base_pred * (2.3 if has_festival else 1.0) * (1.5 if has_promo else 1.0)
            confidence = "low"
        else:
            baseline_row = _build_feature_row(artifact, product_row, future_date, False, False, roll7, roll14, low_history, store_id)
            predicted_row = _build_feature_row(artifact, product_row, future_date, has_festival, has_promo, roll7, roll14, low_history, store_id)
            baseline = float(model.predict(baseline_row)[0])
            predicted = float(model.predict(predicted_row)[0])
            confidence = "normal"

        predicted = max(0, predicted)
        baseline = max(0, baseline)

        results.append({
            "date": date_str,
            "baseline_demand": round(baseline, 1),
            "predicted_demand": round(predicted, 1),
            "event_uplift": round(predicted - baseline, 1),
            "is_festival": has_festival,
            "is_promotion": has_promo,
            "confidence": confidence,
        })

    return {
        "product_id": product_id,
        "product_name": product_row.get("product_name", product_row.get("name", product_id)),
        "category": product_row["category"],
        "store_id": store_id or product_row.get("store_id", "S001"),
        "history_days": history_len,
        "low_confidence": low_history,
        "forecast": results,
    }


def load_model():
    cfg = get_config()
    if os.path.exists(cfg.ACTIVE_MODEL_PATH):
        try:
            return joblib.load(cfg.ACTIVE_MODEL_PATH)
        except Exception as e:
            logger.error(f"Error loading model from {cfg.ACTIVE_MODEL_PATH}: {e}")
    return None
