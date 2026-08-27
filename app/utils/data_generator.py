"""
Synthetic Sales Data Generator
------------------------------
Generates realistic historical sales data for a local retail store, simulating:
- Base daily demand per product
- Weekend upliftl
- Festival / event spikes
- Salary period (1st-5th of month) upliftl
- Promotion spikes
- Random noise, occasional stock-outs (zero sales due to no stock) and missing records

This is used because no real POS dataset was provided in the problem statement.
In production, this module is replaced by a real data ingestion pipeline (CSV upload / POS API).
"""
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import random

random.seed(42)
np.random.seed(42)

PRODUCTS = [
    {"product_id": "P001", "name": "Packaged Snack A", "category": "Snacks", "base_demand": 40, "price": 20, "initial_stock": 150},
    {"product_id": "P002", "name": "Soft Drink 500ml", "category": "Beverages", "base_demand": 60, "price": 35, "initial_stock": 200},
    {"product_id": "P003", "name": "Instant Noodles", "category": "Packaged Food", "base_demand": 55, "price": 15, "initial_stock": 180},
    {"product_id": "P004", "name": "Milk 1L", "category": "Dairy", "base_demand": 80, "price": 55, "initial_stock": 220},
    {"product_id": "P005", "name": "Detergent Powder 1kg", "category": "Household", "base_demand": 15, "price": 110, "initial_stock": 60},
    {"product_id": "P006", "name": "Notebook Pack", "category": "Stationery", "base_demand": 8, "price": 90, "initial_stock": 40},
    {"product_id": "P007", "name": "Chocolate Bar", "category": "Confectionery", "base_demand": 35, "price": 40, "initial_stock": 130},
    {"product_id": "P008", "name": "Cooking Oil 1L", "category": "Grocery", "base_demand": 20, "price": 150, "initial_stock": 70},
    {"product_id": "P009", "name": "Bakery - Bread", "category": "Bakery", "base_demand": 45, "price": 45, "initial_stock": 90},
    {"product_id": "P010", "name": "New Energy Drink", "category": "Beverages", "base_demand": 5, "price": 60, "initial_stock": 50},  # new product, little history
]

# Festivals / local events in the simulated window (India-relevant, generic)
FESTIVALS = {
    "2025-10-20": "Diwali",
    "2025-10-21": "Diwali",
    "2026-01-14": "Pongal/Makar Sankranti",
    "2026-03-04": "Holi",
    "2026-05-01": "Local Town Festival",
}

WEATHER_OPTIONS = ["Clear", "Rainy", "Hot", "Cloudy"]


def is_salary_period(date):
    return date.day <= 5


def is_weekend(date):
    return date.weekday() >= 5  # Sat/Sun


def generate_sales_data(start_date="2025-06-01", end_date="2026-05-31", out_path=None):
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    rows = []
    for product in PRODUCTS:
        pid = product["product_id"]
        base = product["base_demand"]
        # New product (P010) only has history for the last 20 days
        product_dates = dates
        if pid == "P010":
            product_dates = dates[-20:]

        # Track running stock for stock-out simulation
        running_stock = product["initial_stock"]

        for date in product_dates:
            date_str = date.strftime("%Y-%m-%d")
            weekend = is_weekend(date)
            salary_period = is_salary_period(date)
            festival = FESTIVALS.get(date_str, None)
            is_festival = festival is not None
            weather = random.choices(WEATHER_OPTIONS, weights=[0.55, 0.15, 0.2, 0.1])[0]
            # Promotion: random 6% of days, never on festival days (avoid confound for demo clarity)
            promotion = (random.random() < 0.06) and not is_festival

            # ---- Demand model (ground truth simulation) ----
            demand = base
            if weekend:
                demand *= 1.35
            if salary_period:
                demand *= 1.20
            if is_festival:
                demand *= random.uniform(2.2, 3.0)  # festival spike
            if promotion:
                demand *= random.uniform(1.4, 1.8)
            if weather == "Rainy" and product["category"] in ("Beverages", "Bakery"):
                demand *= 0.85
            if weather == "Hot" and product["category"] == "Beverages":
                demand *= 1.25

            # Natural noise
            demand *= np.random.normal(1.0, 0.12)
            demand = max(0, demand)

            # One-day abnormal spike / anomaly injection (rare, ~0.8% of rows, not tied to known event)
            anomaly = False
            if random.random() < 0.008:
                demand *= random.uniform(2.5, 4)
                anomaly = True

            quantity_demanded = int(round(demand))

            # Stock-out simulation: if running stock is low, actual quantity sold is capped
            quantity_sold = min(quantity_demanded, running_stock)
            stock_out_occurred = quantity_sold < quantity_demanded

            running_stock -= quantity_sold
            # Restock simulation: every 3 days, a reasonably sized restock happens
            if date.day % 3 == 0:
                running_stock += int(base * random.uniform(3.0, 4.0))

            # Missing record simulation (~1.5% chance record is just absent)
            if random.random() < 0.015:
                continue

            rows.append({
                "product_id": pid,
                "product_name": product["name"],
                "category": product["category"],
                "date": date_str,
                "quantity_sold": quantity_sold,
                "current_stock": running_stock,
                "price": product["price"],
                "promotion": int(promotion),
                "festival_event": festival if festival else "",
                "day_type": "Weekend" if weekend else "Weekday",
                "salary_period": int(salary_period),
                "holiday": int(is_festival),  # treat festivals as holidays too for this dataset
                "weather": weather,
                "_is_known_event": int(is_festival or promotion),
                "_is_anomaly": int(anomaly),
                "_stock_out_occurred": int(stock_out_occurred),
            })

    df = pd.DataFrame(rows)
    if out_path:
        df.to_csv(out_path, index=False)
    return df


def get_product_master():
    return pd.DataFrame(PRODUCTS)


if __name__ == "__main__":
    df = generate_sales_data(out_path="/home/claude/retail_demand_system/data/historical_sales.csv")
    get_product_master().to_csv("/home/claude/retail_demand_system/data/product_master.csv", index=False)
    print(f"Generated {len(df)} sales records across {df['product_id'].nunique()} products")
    print(df.head())
