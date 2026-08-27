"""
Data Cleaning & Validation
---------------------------
Requirement #2 from system flow: Data Cleaning & Validation.

Handles:
- Missing sales records (fills gaps in date range per product/store with 0 sold, flagged 'missing_filled')
- Duplicate rows
- Invalid values (negative quantities, negative stock)
- Multi-store group preservation
- Type coercion for dates
"""
import pandas as pd
import numpy as np


def clean_sales_data(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    if df.empty:
        return df, {
            "total_rows_after_cleaning": 0,
            "missing_records_filled": 0,
            "duplicates_removed": 0,
            "negative_values_corrected": 0,
            "products_covered": 0,
            "date_range": [None, None],
        }

    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    if "store_id" not in df.columns:
        df["store_id"] = "S001"

    # Remove exact duplicates
    dedup_cols = ["store_id", "product_id", "date"]
    dup_count = int(df.duplicated(subset=dedup_cols).sum())
    df = df.drop_duplicates(subset=dedup_cols)

    # Fix invalid negative values
    neg_count = int((df["quantity_sold"] < 0).sum() + (df["current_stock"] < 0).sum())
    df["quantity_sold"] = df["quantity_sold"].clip(lower=0)
    df["current_stock"] = df["current_stock"].clip(lower=0)

    # Fill missing categorical fields
    for col in ["festival_event", "weather", "day_type"]:
        if col in df.columns:
            df[col] = df[col].fillna("")

    df["is_missing_filled"] = 0

    # Reindex per (product_id, store_id) to detect and fill missing date gaps
    filled_frames = []
    for (pid, sid), g in df.groupby(["product_id", "store_id"]):
        g = g.sort_values("date").set_index("date")
        full_range = pd.date_range(g.index.min(), g.index.max(), freq="D")
        g_reindexed = g.reindex(full_range)

        missing_mask = g_reindexed["quantity_sold"].isna()
        g_reindexed["is_missing_filled"] = missing_mask.astype(int)

        # Forward-fill descriptive/static fields
        static_cols = ["product_id", "store_id", "product_name", "category", "price", "supplier_id"]
        for c in static_cols:
            if c in g_reindexed.columns:
                g_reindexed[c] = g_reindexed[c].ffill().bfill()

        g_reindexed["quantity_sold"] = g_reindexed["quantity_sold"].fillna(0)
        g_reindexed["current_stock"] = g_reindexed["current_stock"].ffill().fillna(0)
        
        g_reindexed["promotion"] = g_reindexed["promotion"].fillna(0) if "promotion" in g_reindexed.columns else 0
        g_reindexed["festival_event"] = g_reindexed["festival_event"].fillna("") if "festival_event" in g_reindexed.columns else ""
        g_reindexed["day_type"] = g_reindexed.index.to_series().apply(
            lambda d: "Weekend" if d.weekday() >= 5 else "Weekday"
        )
        g_reindexed["salary_period"] = g_reindexed.index.to_series().apply(lambda d: int(d.day <= 5))
        g_reindexed["holiday"] = g_reindexed["holiday"].fillna(0) if "holiday" in g_reindexed.columns else 0
        g_reindexed["weather"] = g_reindexed["weather"].ffill().fillna("Clear") if "weather" in g_reindexed.columns else "Clear"

        g_reindexed = g_reindexed.reset_index().rename(columns={"index": "date"})
        filled_frames.append(g_reindexed)

    result = pd.concat(filled_frames, ignore_index=True)
    result = result.sort_values(["store_id", "product_id", "date"]).reset_index(drop=True)

    report = {
        "total_rows_after_cleaning": len(result),
        "missing_records_filled": int(result["is_missing_filled"].sum()),
        "duplicates_removed": dup_count,
        "negative_values_corrected": neg_count,
        "products_covered": result["product_id"].nunique(),
        "date_range": [str(result["date"].min().date()), str(result["date"].max().date())],
    }
    return result, report
