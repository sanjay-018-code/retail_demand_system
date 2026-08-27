"""
Unit Tests for Data Cleaning & Validation (Req #2, #17)
"""
import pytest
import pandas as pd
import numpy as np
from app.utils.data_cleaning import clean_sales_data

def test_clean_sales_data_removes_duplicates_and_negative_values():
    raw_data = pd.DataFrame([
        {"product_id": "P001", "store_id": "S001", "date": "2026-01-01", "quantity_sold": 10, "current_stock": 50, "price": 20},
        {"product_id": "P001", "store_id": "S001", "date": "2026-01-01", "quantity_sold": 10, "current_stock": 50, "price": 20},  # Duplicate
        {"product_id": "P001", "store_id": "S001", "date": "2026-01-02", "quantity_sold": -5, "current_stock": -10, "price": 20},  # Negatives
        {"product_id": "P001", "store_id": "S001", "date": "2026-01-04", "quantity_sold": 12, "current_stock": 40, "price": 20},  # Gap on Jan 3
    ])
    
    clean_df, report = clean_sales_data(raw_data)
    
    # Check deduplication
    assert report["duplicates_removed"] == 1
    # Check negative values corrected
    assert report["negative_values_corrected"] == 2
    assert (clean_df["quantity_sold"] >= 0).all()
    assert (clean_df["current_stock"] >= 0).all()
    # Check missing date reindexing (Jan 3 was filled)
    assert report["missing_records_filled"] == 1
    jan3_row = clean_df[clean_df["date"] == "2026-01-03"]
    assert len(jan3_row) == 1
    assert jan3_row.iloc[0]["is_missing_filled"] == 1
    assert jan3_row.iloc[0]["quantity_sold"] == 0

def test_clean_sales_data_empty_input():
    empty_df = pd.DataFrame(columns=["product_id", "store_id", "date", "quantity_sold", "current_stock"])
    clean_df, report = clean_sales_data(empty_df)
    assert clean_df.empty
    assert report["total_rows_after_cleaning"] == 0
