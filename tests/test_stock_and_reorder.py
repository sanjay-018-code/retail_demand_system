"""
Unit Tests for Stock Alerts, Reorder Engine & Simulation (Req #7, #8, #24, #26, #28)
"""
import pytest
from app.utils.stock_alerts import evaluate_stock_status
from app.utils.reorder_engine import calculate_reorder_recommendations, generate_po_for_item
from app.utils.simulation import run_scenario_simulation
from app.utils.data_generator import generate_sales_data
from app.utils.data_cleaning import clean_sales_data
from app.models.predictor import train_and_evaluate_model
from app import db

def test_stock_alerts_classification():
    forecast = [
        {"date": "2026-06-01", "baseline_demand": 20, "predicted_demand": 20, "is_festival": False, "is_promotion": False},
        {"date": "2026-06-02", "baseline_demand": 20, "predicted_demand": 20, "is_festival": False, "is_promotion": False},
    ]
    # Total 2-day demand = 40. With 1.15 margin = 46.
    
    # 1. Stockout risk when current stock is 20
    alert_stockout = evaluate_stock_status("P001", "Snack", current_stock=20, forecast=forecast, lead_time_days=2)
    assert alert_stockout["status"] == "Stock-Out Risk"
    assert "Replenish" in alert_stockout["alert"]

    # 2. Overstock risk when current stock is 100 (>2x 40)
    alert_overstock = evaluate_stock_status("P001", "Snack", current_stock=100, forecast=forecast, lead_time_days=2)
    assert alert_overstock["status"] == "Overstock Risk"

    # 3. Balanced when current stock is 50 (between 46 and 80)
    alert_balanced = evaluate_stock_status("P001", "Snack", current_stock=50, forecast=forecast, lead_time_days=2)
    assert alert_balanced["status"] == "Balanced"

def test_reorder_engine_and_po_creation():
    db.init_schema()
    raw = generate_sales_data()
    clean_df, _ = clean_sales_data(raw)
    
    sample_alerts = [{
        "product_id": "P001",
        "product_name": "Packaged Snack A",
        "current_stock": 10,
        "predicted_demand_horizon": 140,
        "forecast": [{"predicted_demand": 20}] * 7
    }]
    
    recs = calculate_reorder_recommendations(clean_df, sample_alerts)
    assert len(recs) == 1
    rec = recs[0]
    assert rec["reorder_needed"] is True
    assert rec["suggested_order_qty"] >= rec["moq"]
    assert rec["urgency"] in ("High", "Medium")

    # PO Creation
    po = generate_po_for_item("S001", "P001", order_qty=100, notes="Unit test PO")
    assert po["po_id"].startswith("PO-")
    assert po["status"] == "Pending"

def test_what_if_simulation():
    db.init_schema()
    raw = generate_sales_data()
    clean_df, _ = clean_sales_data(raw)
    artifact, full_df, _ = train_and_evaluate_model(clean_df)
    
    sim = run_scenario_simulation(
        artifact, full_df, "P001", horizon_days=7, discount_pct=20.0,
        promo_days=["2026-06-02", "2026-06-03"]
    )
    assert sim is not None
    assert sim["total_simulated_demand"] >= sim["total_baseline_demand"]
    assert sim["discount_pct"] == 20.0
    assert "timeline" in sim
    assert len(sim["timeline"]) == 7
