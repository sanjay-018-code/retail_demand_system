"""
Unit Tests for Model Evaluation, Versioning & Rollback (Req #6, #9, #14, #15)
"""
import pytest
import pandas as pd
import numpy as np
from app.utils.data_generator import generate_sales_data
from app.utils.data_cleaning import clean_sales_data
from app.models.predictor import train_and_evaluate_model, predict_horizon, rollback_to_version
from app import db

@pytest.fixture(scope="module")
def trained_pipeline():
    db.init_schema()
    raw = generate_sales_data()
    clean_df, _ = clean_sales_data(raw)
    artifact, full_df, stats = train_and_evaluate_model(clean_df)
    return artifact, full_df, stats

def test_model_evaluation_metrics(trained_pipeline):
    artifact, full_df, stats = trained_pipeline
    
    assert "mae" in stats
    assert "rmse" in stats
    assert stats["mae"] >= 0
    assert stats["rmse"] >= 0
    assert stats["accepted"] is True
    assert stats["version_id"].startswith("v_")

def test_dual_prediction_isolates_festival_uplift(trained_pipeline):
    artifact, full_df, stats = trained_pipeline
    
    # Predict without declared events
    pred_normal = predict_horizon(artifact, full_df, "P001", horizon_days=7)
    assert pred_normal is not None
    assert len(pred_normal["forecast"]) == 7
    
    # Declared festival on the 2nd forecast day
    fest_date = pred_normal["forecast"][1]["date"]
    pred_fest = predict_horizon(artifact, full_df, "P001", horizon_days=7, upcoming_festivals={fest_date})
    
    fest_day_forecast = pred_fest["forecast"][1]
    assert fest_day_forecast["is_festival"] is True
    assert fest_day_forecast["predicted_demand"] > fest_day_forecast["baseline_demand"]
    assert fest_day_forecast["event_uplift"] > 0
    # Normal days should maintain identical baseline demand
    normal_day = pred_fest["forecast"][0]
    assert normal_day["event_uplift"] == 0

def test_model_version_and_rollback(trained_pipeline):
    artifact, full_df, stats = trained_pipeline
    version_id = stats["version_id"]
    
    # Verify version in database
    versions = db.list_model_versions()
    assert not versions.empty
    assert version_id in versions["version_id"].values
    
    # Test rollback
    rolled_artifact, msg = rollback_to_version(version_id)
    assert rolled_artifact is not None
    assert "Successfully rolled back" in msg
