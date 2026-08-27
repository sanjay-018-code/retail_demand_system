"""
Unit Tests for Demand Analysis & Mover Classification (Req #2, #3, #4, #5, #27)
"""
import pytest
import pandas as pd
from app.utils.demand_analysis import compute_daily_demand, compute_weekly_demand, classify_movers, compute_seasonality_profile

def test_demand_aggregations_and_movers():
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    records = []
    for d in dates:
        # P001: high volume (50/day)
        records.append({"product_id": "P001", "product_name": "High Seller", "category": "Snacks", "date": d.strftime("%Y-%m-%d"), "quantity_sold": 50})
        # P002: medium volume (20/day)
        records.append({"product_id": "P002", "product_name": "Med Seller", "category": "Snacks", "date": d.strftime("%Y-%m-%d"), "quantity_sold": 20})
        # P003: low volume (2/day)
        records.append({"product_id": "P003", "product_name": "Low Seller", "category": "Household", "date": d.strftime("%Y-%m-%d"), "quantity_sold": 2})

    df = pd.DataFrame(records)

    daily = compute_daily_demand(df)
    assert len(daily) == 90

    weekly = compute_weekly_demand(df)
    assert not weekly.empty

    movers = classify_movers(df, recent_days=30)
    assert len(movers) == 3
    
    fast = movers[movers["product_id"] == "P001"].iloc[0]
    assert fast["movement_class"] == "Fast-Moving"
    
    slow = movers[movers["product_id"] == "P003"].iloc[0]
    assert slow["movement_class"] == "Slow-Moving"

    seasonality = compute_seasonality_profile(df, "P001")
    assert "day_of_week_seasonality" in seasonality
    assert "Monday" in seasonality["day_of_week_seasonality"]
