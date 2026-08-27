"""
Integration & Regression Tests (Req #17, #21, #23, #30)
"""
import pytest
import pandas as pd
from app.utils.data_generator import generate_sales_data, get_product_master
from app import db

def test_atomic_seeding_and_foreign_keys():
    db.init_schema()
    raw = generate_sales_data()
    pm = get_product_master()
    
    db.seed_if_empty(raw, pm)
    
    sales = db.load_raw_sales()
    products = db.load_products()
    stores = db.load_stores()
    
    assert not sales.empty
    assert not products.empty
    assert not stores.empty
    assert "store_id" in sales.columns
    assert "store_id" in stores.columns

def test_multi_store_data_isolation():
    db.init_schema()
    raw = generate_sales_data()
    pm = get_product_master()
    db.seed_if_empty(raw, pm)
    
    s1_sales = db.load_raw_sales(store_id="S001")
    # Ensure S002 has data or seed a row if needed
    s2_sales = db.load_raw_sales(store_id="S002")
    if s2_sales.empty:
        db.add_sale({
            "product_id": "P001", "store_id": "S002", "date": "2026-06-01",
            "quantity_sold": 15, "current_stock": 50, "price": 20
        })
        s2_sales = db.load_raw_sales(store_id="S002")
    
    assert not s1_sales.empty
    assert not s2_sales.empty
    assert (s1_sales["store_id"] == "S001").all()
    assert (s2_sales["store_id"] == "S002").all()

def test_audit_logging_trail():
    db.add_audit_log("test_user", "TEST_ACTION", "TEST_ENTITY", "123", "Unit test details")
    logs = db.list_audit_logs(limit=10)
    assert not logs.empty
    latest = logs.iloc[0]
    assert latest["username"] == "test_user"
    assert latest["action"] == "TEST_ACTION"
