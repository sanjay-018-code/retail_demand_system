"""
Integration Tests for Authentication, RBAC & Security (Req #10, #11, #13, #19)
"""
import pytest
import json
import uuid
from app.main import app
from app import db

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_unauthenticated_requests_fail(client):
    resp_prod = client.post("/api/manage/products", json={"product_id": "P999", "name": "Test", "category": "Test", "price": 10})
    assert resp_prod.status_code == 401
    
    resp_sale = client.post("/api/manage/sales", json={"product_id": "P001", "date": "2026-06-01", "quantity_sold": 5, "current_stock": 20})
    assert resp_sale.status_code == 401

    resp_del = client.delete("/api/manage/products/P001")
    assert resp_del.status_code == 401

def test_viewer_role_cannot_mutate(client):
    client.post("/api/auth/login", json={"username": "viewer", "password": "viewer123"})
    
    resp_read = client.get("/api/overview")
    assert resp_read.status_code == 200

    resp_mutate = client.post("/api/manage/products", json={"product_id": "P999", "name": "Test", "category": "Test", "price": 10})
    assert resp_mutate.status_code == 403

def test_manager_permissions(client):
    client.post("/api/auth/login", json={"username": "manager", "password": "manager123"})
    
    resp_add = client.post("/api/manage/products", json={"product_id": "P999", "name": "Manager Snack", "category": "Snacks", "price": 25})
    assert resp_add.status_code == 200

    resp_del = client.delete("/api/manage/products/P999")
    assert resp_del.status_code == 403

def test_admin_permissions_and_user_mgmt(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    
    resp_users = client.get("/api/manage/users")
    assert resp_users.status_code == 200
    
    unique_user = f"staff_{uuid.uuid4().hex[:6]}"
    resp_create_u = client.post("/api/manage/users", json={"username": unique_user, "password": "pass123", "role": "Viewer"})
    assert resp_create_u.status_code == 200
    
    resp_backup = client.post("/api/manage/backup")
    assert resp_backup.status_code == 200
    assert "backup_path" in resp_backup.get_json()

def test_api_key_authentication(client):
    headers = {"X-API-Key": "key-manager-secure-token"}
    resp = client.post("/api/manage/sales", headers=headers, json={
        "product_id": "P001", "date": "2026-06-01", "quantity_sold": 10, "current_stock": 50, "price": 20
    })
    assert resp.status_code == 200
