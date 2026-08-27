"""
Daily / Weekly Demand Analysis, Fast/Slow Mover Classification & Seasonality
=============================================================================
Requirements #2, #3, #4, #5, #27:
- Daily demand
- Weekly demand
- Mover classification (terciles)
- Seasonality & Historical trend analysis (YoY, Day-of-week seasonality, Month seasonality)
"""
import pandas as pd
import numpy as np


def compute_daily_demand(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["product_id", "product_name", "date", "daily_demand"])
    group_cols = ["product_id", "date"]
    if "product_name" in df.columns:
        group_cols.insert(1, "product_name")
    if "store_id" in df.columns:
        group_cols.insert(0, "store_id")

    daily = (
        df.groupby(group_cols)["quantity_sold"]
        .sum()
        .reset_index()
        .rename(columns={"quantity_sold": "daily_demand"})
    )
    return daily.sort_values(group_cols)


def compute_weekly_demand(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["product_id", "product_name", "week", "weekly_demand"])
    df = df.copy()
    df["week"] = pd.to_datetime(df["date"]).dt.to_period("W").apply(lambda p: p.start_time)
    group_cols = ["product_id", "week"]
    if "product_name" in df.columns:
        group_cols.insert(1, "product_name")
    if "store_id" in df.columns:
        group_cols.insert(0, "store_id")

    weekly = (
        df.groupby(group_cols)["quantity_sold"]
        .sum()
        .reset_index()
        .rename(columns={"quantity_sold": "weekly_demand"})
    )
    return weekly.sort_values(group_cols)


def classify_movers(df: pd.DataFrame, recent_days: int = 30) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["product_id", "product_name", "category", "avg_daily_demand", "total_recent_demand", "movement_class"])
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    max_date = df["date"].max()
    cutoff = max_date - pd.Timedelta(days=recent_days)
    recent = df[df["date"] >= cutoff]

    cols = ["product_id"]
    if "product_name" in recent.columns:
        cols.append("product_name")
    if "category" in recent.columns:
        cols.append("category")

    summary = (
        recent.groupby(cols)["quantity_sold"]
        .agg(avg_daily_demand="mean", total_recent_demand="sum")
        .reset_index()
    )
    if not summary.empty:
        summary = summary.sort_values("avg_daily_demand", ascending=False).reset_index(drop=True)
        n = len(summary)
        fast_cutoff = max(1, n // 3)
        slow_cutoff = n - max(1, n // 3)

        def label(i):
            if i < fast_cutoff:
                return "Fast-Moving"
            elif i >= slow_cutoff:
                return "Slow-Moving"
            return "Medium-Moving"

        summary["movement_class"] = [label(i) for i in range(n)]
        summary["avg_daily_demand"] = summary["avg_daily_demand"].round(2)
    return summary


def compute_seasonality_profile(df: pd.DataFrame, product_id: str = None) -> dict:
    """
    Computes seasonality indices: Day of Week distribution and Monthly distribution (Req #27).
    """
    if df.empty:
        return {"dow": {}, "monthly": {}}
    d = df if not product_id else df[df["product_id"] == product_id]
    d = d.copy()
    d["date"] = pd.to_datetime(d["date"])
    d["dow_name"] = d["date"].dt.day_name()
    d["month_name"] = d["date"].dt.month_name()

    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_avg = d.groupby("dow_name")["quantity_sold"].mean().to_dict()
    dow_ordered = {k: round(dow_avg.get(k, 0.0), 1) for k in dow_order if k in dow_avg or True}

    month_order = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    m_avg = d.groupby("month_name")["quantity_sold"].mean().to_dict()
    monthly_ordered = {m: round(m_avg[m], 1) for m in month_order if m in m_avg}

    return {
        "day_of_week_seasonality": dow_ordered,
        "monthly_seasonality": monthly_ordered,
    }
