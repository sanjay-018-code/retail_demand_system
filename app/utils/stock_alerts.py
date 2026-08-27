"""
Stock-out / Overstock Detection & Recommendation Engine
--------------------------------------------------------
Requirements #7 and #8 (Section 10 & 11 of Problem Statement):
- Compare predicted demand against current stock
- Classify Stock-Out Risk, Overstock Risk, and Balanced stock
- Produce simple explanations matching Section 11 Example:
    Product: [Name]
    Predicted demand: [X] units for the upcoming period
    Current stock: [Y] units
    Recommendation: [Actionable advice]
    Reason: [Clear context-based rationale]
"""
import pandas as pd


def evaluate_stock_status(product_id, product_name, current_stock, forecast, lead_time_days=7,
                           overstock_multiplier=2.0, safety_margin=1.15):
    """
    current_stock: latest known stock level
    forecast: list of daily forecast dicts (from predictor.predict_horizon), using 'predicted_demand'
    lead_time_days: how many forecast days to consider for the replenishment window
    """
    horizon = forecast[:lead_time_days]
    total_predicted_demand = sum(f["predicted_demand"] for f in horizon)
    total_baseline_demand = sum(f["baseline_demand"] for f in horizon)
    event_days = [f["date"] for f in horizon if f.get("is_festival") or f.get("is_promotion")]
    weekend_days = [f["date"] for f in horizon if pd.to_datetime(f["date"]).weekday() >= 5]

    status = "Balanced"
    recommendation = ""
    reason = ""

    required_with_margin = total_predicted_demand * safety_margin

    if current_stock < required_with_margin:
        status = "Stock-Out Risk"
        shortfall = round(required_with_margin - current_stock, 1)
        recommendation = f"Consider replenishment of ~{shortfall:.0f} units because predicted demand ({total_predicted_demand:.0f} units) is higher than available stock ({current_stock:.0f} units)."
        
        reasons_list = []
        if event_days:
            reasons_list.append(f"upcoming special events on {', '.join(event_days[:2])}")
        if weekend_days:
            reasons_list.append(f"{len(weekend_days)} weekend days")
        reasons_list.append("recent sales trajectory indicating higher short-term run-rate")
        
        reason = f"Upcoming {lead_time_days}-day demand of {total_predicted_demand:.0f} units exceeds available stock of {current_stock:.0f} units due to {' and '.join(reasons_list)}."
        alert = f"Replenish ~{shortfall} units"

    elif current_stock > (total_predicted_demand * overstock_multiplier):
        status = "Overstock Risk"
        excess = round(current_stock - (total_predicted_demand * overstock_multiplier), 1)
        recommendation = f"Consider reducing next order by ~{excess:.0f} units because current stock ({current_stock:.0f} units) is more than {overstock_multiplier:.1f}x projected demand ({total_predicted_demand:.0f} units)."
        reason = f"Current inventory ({current_stock:.0f} units) significantly exceeds projected {lead_time_days}-day demand ({total_predicted_demand:.0f} units), creating holding cost risk."
        alert = f"Reduce next order by ~{excess} units"

    else:
        status = "Balanced"
        recommendation = f"Maintain current order schedule; inventory ({current_stock:.0f} units) safely covers predicted {lead_time_days}-day demand ({total_predicted_demand:.0f} units)."
        reason = f"Current stock ({current_stock:.0f} units) reasonably matches predicted {lead_time_days}-day demand ({total_predicted_demand:.0f} units)."
        alert = "Stock level optimal"

    return {
        "product_id": product_id,
        "product_name": product_name,
        "current_stock": current_stock,
        "predicted_demand_horizon": round(total_predicted_demand, 1),
        "baseline_demand_horizon": round(total_baseline_demand, 1),
        "event_uplift_horizon": round(total_predicted_demand - total_baseline_demand, 1),
        "status": status,
        "recommendation": recommendation,
        "reason": reason,
        "alert": alert,
        "event_days": event_days,
        "lead_time_days": lead_time_days,
    }
