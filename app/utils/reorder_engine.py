"""
Automated Reorder Point (ROP) & Purchase Order (PO) Engine
==========================================================
Requirements #24 & #26:
- Lead-time demand & safety stock calculations
- Runout date estimation
- Supplier MOQ and lead-time integration
- Automated Purchase Order creation & CSV export
"""
import numpy as np
import pandas as pd
import datetime
import math
from app import db
from app.utils.logger import logger


def calculate_reorder_recommendations(clean_df: pd.DataFrame, alerts: list, store_id: str = None) -> list:
    """
    Computes reorder point (ROP), safety stock, suggested reorder quantity,
    and recommended order date for each product in stock alerts.
    """
    products_df = db.load_products()
    prod_map = {row["product_id"]: row for _, row in products_df.iterrows()}
    
    recommendations = []
    today = datetime.date.today()

    for alert in alerts:
        pid = alert["product_id"]
        prod_meta = prod_map.get(pid, {})
        
        lead_time_raw = prod_meta.get("lead_time_days")
        lead_time = int(lead_time_raw) if pd.notna(lead_time_raw) else 5
        
        moq_raw = prod_meta.get("moq")
        moq = int(moq_raw) if pd.notna(moq_raw) else 20

        supplier_id_raw = prod_meta.get("supplier_id")
        supplier_id = str(supplier_id_raw) if pd.notna(supplier_id_raw) and supplier_id_raw else "SUP01"
        
        supplier_name_raw = prod_meta.get("supplier_name")
        supplier_name = str(supplier_name_raw) if pd.notna(supplier_name_raw) and supplier_name_raw else "Primary Supplier"
        
        price_raw = prod_meta.get("price")
        price = float(price_raw) if pd.notna(price_raw) else 50.0

        # Calculate daily demand volatility (std)
        hist = clean_df[clean_df["product_id"] == pid]
        if store_id and store_id != "all" and "store_id" in hist.columns:
            hist = hist[hist["store_id"] == store_id]

        daily_std = float(hist["quantity_sold"].std(ddof=0)) if len(hist) > 5 else 3.0
        avg_daily_demand = max(0.5, float(alert["predicted_demand_horizon"]) / max(1, len(alert.get("forecast", [1]*7))))

        # Safety Stock formula: Z (95% service level = 1.65) * std * sqrt(lead_time)
        safety_stock = math.ceil(1.65 * daily_std * math.sqrt(lead_time))
        
        # Lead Time Demand
        lead_time_demand = avg_daily_demand * lead_time
        
        # Reorder Point (ROP) = Lead Time Demand + Safety Stock
        rop = math.ceil(lead_time_demand + safety_stock)
        
        current_stock = float(alert["current_stock"])
        
        # Days of Inventory Remaining (Runout estimation)
        days_remaining = round(current_stock / avg_daily_demand, 1) if avg_daily_demand > 0 else 999.0
        
        # Is reorder required now?
        reorder_needed = current_stock <= rop
        
        # Suggested Order Quantity: Target 14 days of inventory + safety stock, capped to MOQ
        target_inventory = math.ceil((avg_daily_demand * 14) + safety_stock)
        raw_order_qty = max(0, target_inventory - current_stock)
        suggested_qty = max(moq, math.ceil(raw_order_qty)) if reorder_needed else 0
        
        # Reorder by date
        days_until_rop = max(0, int((current_stock - rop) / avg_daily_demand)) if avg_daily_demand > 0 and current_stock > rop else 0
        reorder_by_date = (today + datetime.timedelta(days=days_until_rop)).strftime("%Y-%m-%d")
        expected_arrival_date = (datetime.datetime.strptime(reorder_by_date, "%Y-%m-%d") + datetime.timedelta(days=lead_time)).strftime("%Y-%m-%d")

        recommendations.append({
            "product_id": pid,
            "product_name": alert["product_name"],
            "supplier_id": supplier_id,
            "supplier_name": supplier_name,
            "lead_time_days": lead_time,
            "moq": moq,
            "current_stock": current_stock,
            "avg_daily_demand": round(avg_daily_demand, 1),
            "safety_stock": safety_stock,
            "reorder_point": rop,
            "days_stock_remaining": days_remaining,
            "reorder_needed": reorder_needed,
            "suggested_order_qty": suggested_qty,
            "estimated_order_cost": round(suggested_qty * price, 2),
            "reorder_by_date": reorder_by_date,
            "expected_arrival_date": expected_arrival_date,
            "urgency": "High" if current_stock < (rop * 0.5) else ("Medium" if reorder_needed else "Normal"),
        })

    # Sort high urgency first
    urgency_order = {"High": 0, "Medium": 1, "Normal": 2}
    recommendations.sort(key=lambda x: (urgency_order.get(x["urgency"], 3), x["days_stock_remaining"]))
    return recommendations


def generate_po_for_item(store_id: str, product_id: str, order_qty: float, notes: str = "") -> dict:
    """Creates a new purchase order in the database."""
    products = db.load_products()
    matched = products[products["product_id"] == product_id]
    if matched.empty:
        raise ValueError(f"Product {product_id} not found")
    
    prod = matched.iloc[0]
    supplier_id_raw = prod.get("supplier_id")
    supplier_id = str(supplier_id_raw) if pd.notna(supplier_id_raw) and supplier_id_raw else "SUP01"
    
    lead_time_raw = prod.get("lead_time_days")
    lead_time = int(lead_time_raw) if pd.notna(lead_time_raw) else 5
    
    today = datetime.date.today()
    expected_date = (today + datetime.timedelta(days=lead_time)).strftime("%Y-%m-%d")
    po_id = f"PO-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}-{product_id}"

    db.create_purchase_order(
        po_id=po_id,
        store_id=store_id or "S001",
        product_id=product_id,
        supplier_id=supplier_id,
        order_qty=float(order_qty),
        order_date=today.strftime("%Y-%m-%d"),
        expected_date=expected_date,
        notes=notes,
    )
    return {
        "po_id": po_id,
        "product_id": product_id,
        "product_name": prod["name"],
        "order_qty": order_qty,
        "supplier_id": supplier_id,
        "expected_date": expected_date,
        "status": "Pending",
    }
