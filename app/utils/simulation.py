"""
What-If / Scenario Simulation Engine
====================================
Requirement #28: Lets the retailer simulate promotional discounts, upcoming festivals,
or seasonal demand shifts before making commitments or inventory purchases.
"""
import pandas as pd
import datetime
from app.models.predictor import predict_horizon, _build_feature_row
from app.utils.logger import logger


def run_scenario_simulation(artifact, full_df, product_id, horizon_days=14, promo_days=None,
                            festival_days=None, discount_pct=0.0, store_id=None):
    """
    Runs dual-prediction simulation:
    - Baseline: Normal conditions
    - Simulated: With user-specified promotions, discounts, or festival dates
    """
    promo_days = set(promo_days or [])
    festival_days = set(festival_days or [])

    subset = full_df[full_df["product_id"] == product_id]
    if store_id and store_id != "all" and "store_id" in subset.columns:
        store_sub = subset[subset["store_id"] == store_id]
        if not store_sub.empty:
            subset = store_sub

    prod_hist = subset.sort_values("date")
    if prod_hist.empty:
        return None

    product_row = prod_hist.iloc[-1]
    last_date = prod_hist["date"].max()
    price = float(product_row.get("price", 50.0))
    current_stock = float(product_row.get("current_stock", 100.0))

    recent_sales = prod_hist[prod_hist.get("is_missing_filled", 0) == 0]["quantity_sold"]
    roll7 = float(recent_sales.tail(7).mean()) if len(recent_sales) else artifact["global_avg_fallback"]
    roll14 = float(recent_sales.tail(14).mean()) if len(recent_sales) else artifact["global_avg_fallback"]

    results = []
    model = artifact["model"]

    total_baseline_units = 0.0
    total_simulated_units = 0.0

    # Discount elasticity factor (heuristic: 10% discount -> ~15-20% uplift)
    discount_multiplier = 1.0 + (max(0.0, min(0.8, discount_pct / 100.0)) * 1.6)

    for i in range(1, horizon_days + 1):
        future_date = last_date + datetime.timedelta(days=i)
        date_str = future_date.strftime("%Y-%m-%d")
        
        is_promo = date_str in promo_days
        is_fest = date_str in festival_days

        baseline_row = _build_feature_row(artifact, product_row, future_date, False, False, roll7, roll14, False, store_id)
        sim_row = _build_feature_row(artifact, product_row, future_date, is_fest, is_promo, roll7, roll14, False, store_id)

        baseline = max(0.0, float(model.predict(baseline_row)[0]))
        simulated = max(0.0, float(model.predict(sim_row)[0]))

        if is_promo and discount_multiplier > 1.0:
            simulated *= discount_multiplier

        total_baseline_units += baseline
        total_simulated_units += simulated

        results.append({
            "date": date_str,
            "baseline_demand": round(baseline, 1),
            "simulated_demand": round(simulated, 1),
            "uplift": round(simulated - baseline, 1),
            "is_promotion": is_promo,
            "is_festival": is_fest,
        })

    effective_price = price * (1.0 - (discount_pct / 100.0))
    baseline_revenue = total_baseline_units * price
    simulated_revenue = total_simulated_units * effective_price
    revenue_delta = simulated_revenue - baseline_revenue

    stock_shortfall = max(0.0, round((total_simulated_units * 1.15) - current_stock, 1))

    return {
        "product_id": product_id,
        "product_name": product_row.get("product_name", product_row.get("name", product_id)),
        "current_stock": current_stock,
        "base_price": price,
        "discount_pct": discount_pct,
        "effective_price": round(effective_price, 2),
        "total_baseline_demand": round(total_baseline_units, 1),
        "total_simulated_demand": round(total_simulated_units, 1),
        "net_demand_uplift": round(total_simulated_units - total_baseline_units, 1),
        "baseline_revenue": round(baseline_revenue, 2),
        "simulated_revenue": round(simulated_revenue, 2),
        "revenue_delta": round(revenue_delta, 2),
        "required_stock_buffer": round(total_simulated_units * 1.15, 1),
        "stock_shortfall": stock_shortfall,
        "risk_assessment": "High Stock-Out Risk" if stock_shortfall > 0 else "Inventory Sufficient",
        "timeline": results,
    }
