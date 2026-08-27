"""
SQLite persistence layer & Schema Management
============================================
Handles:
- Atomic schema creation & migration
- Stores, Users, Suppliers, Products, Raw Sales, Purchase Orders, Model Versions, Audit Logs
- Atomic seeding & backup routines
- Foreign key integrity & safe schema evolution
"""
import sqlite3
import pandas as pd
import os
import shutil
import datetime
from werkzeug.security import generate_password_hash
from app.config import get_config
from app.utils.logger import logger

RAW_SALES_COLUMNS = [
    "product_id", "store_id", "date", "quantity_sold", "current_stock", "price",
    "promotion", "festival_event", "day_type", "salary_period", "holiday", "weather",
]

DEFAULT_STORES = [
    {"store_id": "S001", "name": "Central Superstore", "city": "Metro Center", "location": "Downtown"},
    {"store_id": "S002", "name": "Suburban Express", "city": "North Hills", "location": "Sector 4"},
]

DEFAULT_SUPPLIERS = [
    {"supplier_id": "SUP01", "name": "National Beverage & Dairy Corp", "lead_time_days": 3, "moq": 50, "contact_email": "orders@natbev.example.com"},
    {"supplier_id": "SUP02", "name": "Apex Food & Snack Logistics", "lead_time_days": 5, "moq": 40, "contact_email": "supply@apexfoods.example.com"},
    {"supplier_id": "SUP03", "name": "Evergreen Household Wholesale", "lead_time_days": 7, "moq": 25, "contact_email": "sales@evergreenws.example.com"},
]

DEFAULT_USERS = [
    {"username": "admin", "password": "admin123", "role": "Admin", "api_key": "key-admin-secure-token"},
    {"username": "manager", "password": "manager123", "role": "Manager", "api_key": "key-manager-secure-token"},
    {"username": "viewer", "password": "viewer123", "role": "Viewer", "api_key": "key-viewer-secure-token"},
]


def get_conn():
    cfg = get_config()
    os.makedirs(os.path.dirname(cfg.DB_PATH), exist_ok=True)
    conn = sqlite3.connect(cfg.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema():
    conn = get_conn()
    with conn:
        cur = conn.cursor()
        # 1. Stores
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stores (
                store_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                city TEXT NOT NULL,
                location TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        
        # 2. Suppliers
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suppliers (
                supplier_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                lead_time_days INTEGER NOT NULL DEFAULT 5,
                moq INTEGER NOT NULL DEFAULT 20,
                contact_email TEXT
            )
        """)

        # 3. Users (RBAC)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Viewer')),
                api_key TEXT UNIQUE,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

        # 4. Products
        cur.execute("""
            CREATE TABLE IF NOT EXISTS products (
                product_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                base_demand REAL DEFAULT 0,
                price REAL NOT NULL,
                initial_stock REAL DEFAULT 0,
                supplier_id TEXT,
                FOREIGN KEY(supplier_id) REFERENCES suppliers(supplier_id)
            )
        """)

        # 5. Raw Sales (with store_id)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id TEXT NOT NULL,
                store_id TEXT NOT NULL DEFAULT 'S001',
                date TEXT NOT NULL,
                quantity_sold REAL NOT NULL,
                current_stock REAL NOT NULL,
                price REAL,
                promotion INTEGER DEFAULT 0,
                festival_event TEXT DEFAULT '',
                day_type TEXT,
                salary_period INTEGER DEFAULT 0,
                holiday INTEGER DEFAULT 0,
                weather TEXT DEFAULT 'Clear',
                FOREIGN KEY(product_id) REFERENCES products(product_id),
                FOREIGN KEY(store_id) REFERENCES stores(store_id)
            )
        """)

        # 6. Purchase Orders
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_orders (
                po_id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                supplier_id TEXT NOT NULL,
                order_qty REAL NOT NULL,
                order_date TEXT NOT NULL,
                expected_date TEXT,
                status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Ordered', 'Received', 'Cancelled')),
                notes TEXT,
                FOREIGN KEY(store_id) REFERENCES stores(store_id),
                FOREIGN KEY(product_id) REFERENCES products(product_id),
                FOREIGN KEY(supplier_id) REFERENCES suppliers(supplier_id)
            )
        """)

        # 7. Model Versions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS model_versions (
                version_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                mae REAL NOT NULL,
                rmse REAL NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                artifact_path TEXT NOT NULL,
                training_rows INTEGER NOT NULL,
                feature_importances TEXT
            )
        """)

        # 8. Audit Logs
        cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                username TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                details TEXT
            )
        """)

        # Schema migrations / missing column checks for backwards compatibility
        _migrate_columns_if_missing(cur)
        
        # Seed default stores, suppliers, users if empty
        _seed_defaults_if_empty(cur)
    conn.close()


def _migrate_columns_if_missing(cur):
    # Check if raw_sales has store_id
    cur.execute("PRAGMA table_info(raw_sales)")
    cols = [r[1] for r in cur.fetchall()]
    if "store_id" not in cols and "id" in cols:
        cur.execute("ALTER TABLE raw_sales ADD COLUMN store_id TEXT NOT NULL DEFAULT 'S001'")

    # Check if products has supplier_id
    cur.execute("PRAGMA table_info(products)")
    p_cols = [r[1] for r in cur.fetchall()]
    if "supplier_id" not in p_cols and "product_id" in p_cols:
        cur.execute("ALTER TABLE products ADD COLUMN supplier_id TEXT")


def _seed_defaults_if_empty(cur):
    # Stores
    cur.execute("SELECT COUNT(*) FROM stores")
    if cur.fetchone()[0] == 0:
        for s in DEFAULT_STORES:
            cur.execute("INSERT INTO stores (store_id, name, city, location) VALUES (?, ?, ?, ?)",
                        (s["store_id"], s["name"], s["city"], s["location"]))
            
    # Suppliers
    cur.execute("SELECT COUNT(*) FROM suppliers")
    if cur.fetchone()[0] == 0:
        for sup in DEFAULT_SUPPLIERS:
            cur.execute("INSERT INTO suppliers (supplier_id, name, lead_time_days, moq, contact_email) VALUES (?, ?, ?, ?, ?)",
                        (sup["supplier_id"], sup["name"], sup["lead_time_days"], sup["moq"], sup["contact_email"]))

    # Users
    cur.execute("SELECT COUNT(*) FROM users")
    if cur.fetchone()[0] == 0:
        for u in DEFAULT_USERS:
            pwd_hash = generate_password_hash(u["password"])
            cur.execute("INSERT INTO users (username, password_hash, role, api_key) VALUES (?, ?, ?, ?)",
                        (u["username"], pwd_hash, u["role"], u["api_key"]))


def is_empty() -> bool:
    conn = get_conn()
    n = pd.read_sql("SELECT COUNT(*) as c FROM raw_sales", conn)["c"][0]
    conn.close()
    return n == 0


def seed_if_empty(sales_df: pd.DataFrame, product_master_df: pd.DataFrame):
    """Atomic seeding: all tables are committed in a single atomic transaction block."""
    init_schema()
    conn = get_conn()
    with conn:
        n_products = pd.read_sql("SELECT COUNT(*) as c FROM products", conn)["c"][0]
        if n_products == 0:
            pm = product_master_df.copy()
            if "supplier_id" not in pm.columns:
                # Map categories to default suppliers
                sup_map = {"Beverages": "SUP01", "Dairy": "SUP01", "Snacks": "SUP02", "Packaged Food": "SUP02", "Confectionery": "SUP02"}
                pm["supplier_id"] = pm["category"].map(lambda c: sup_map.get(c, "SUP03"))
            pm.to_sql("products", conn, if_exists="append", index=False)

        n_sales = pd.read_sql("SELECT COUNT(*) as c FROM raw_sales", conn)["c"][0]
        if n_sales == 0:
            df = sales_df.copy()
            df["date"] = df["date"].astype(str)
            if "store_id" not in df.columns:
                df["store_id"] = "S001"
            cols = [c for c in RAW_SALES_COLUMNS if c in df.columns]
            df[cols].to_sql("raw_sales", conn, if_exists="append", index=False)
            
            # Also generate a slice for Store 2 (S002) with 15% variation for multi-store demonstration
            df_s2 = df[cols].copy()
            df_s2["store_id"] = "S002"
            df_s2["quantity_sold"] = (df_s2["quantity_sold"] * 0.85).round()
            df_s2["current_stock"] = (df_s2["current_stock"] * 0.85).round()
            df_s2.to_sql("raw_sales", conn, if_exists="append", index=False)
    conn.close()


def load_raw_sales(store_id: str = None) -> pd.DataFrame:
    conn = get_conn()
    query = "SELECT * FROM raw_sales"
    params = []
    if store_id and store_id != "all":
        query += " WHERE store_id = ?"
        params.append(store_id)
    df = pd.read_sql(query, conn, params=params)
    conn.close()
    
    products = load_products()
    df = df.merge(products[["product_id", "name", "category", "supplier_id"]], on="product_id", how="left")
    df = df.rename(columns={"name": "product_name"})
    return df


def load_products() -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql("SELECT p.*, s.name as supplier_name, s.lead_time_days, s.moq FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id", conn)
    conn.close()
    if not df.empty:
        df["supplier_id"] = df["supplier_id"].fillna("SUP01")
        df["supplier_name"] = df["supplier_name"].fillna("Primary Supplier")
        df["lead_time_days"] = df["lead_time_days"].fillna(5).astype(int)
        df["moq"] = df["moq"].fillna(20).astype(int)
        df["base_demand"] = df["base_demand"].fillna(0)
        df["initial_stock"] = df["initial_stock"].fillna(0)
    return df


def load_stores() -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql("SELECT * FROM stores ORDER BY store_id", conn)
    conn.close()
    return df.fillna("")


def load_suppliers() -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql("SELECT * FROM suppliers ORDER BY supplier_id", conn)
    conn.close()
    return df.fillna("")


# ---------------------------------------------------------------------------
# Product CRUD
# ---------------------------------------------------------------------------
def upsert_product(product_id, name, category, price, base_demand=0, initial_stock=0, supplier_id="SUP01"):
    conn = get_conn()
    with conn:
        conn.execute("""
            INSERT INTO products (product_id, name, category, base_demand, price, initial_stock, supplier_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
                name=excluded.name, category=excluded.category,
                price=excluded.price, base_demand=excluded.base_demand,
                initial_stock=excluded.initial_stock,
                supplier_id=COALESCE(excluded.supplier_id, products.supplier_id)
        """, (product_id, name, category, base_demand, price, initial_stock, supplier_id))
    conn.close()


def delete_product(product_id):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM purchase_orders WHERE product_id=?", (product_id,))
        conn.execute("DELETE FROM raw_sales WHERE product_id=?", (product_id,))
        conn.execute("DELETE FROM products WHERE product_id=?", (product_id,))
    conn.close()


# ---------------------------------------------------------------------------
# Raw sales CRUD
# ---------------------------------------------------------------------------
def add_sale(record: dict):
    conn = get_conn()
    if "store_id" not in record or not record["store_id"]:
        record["store_id"] = "S001"
    cols = [c for c in RAW_SALES_COLUMNS if c in record]
    placeholders = ",".join("?" for _ in cols)
    with conn:
        conn.execute(
            f"INSERT INTO raw_sales ({','.join(cols)}) VALUES ({placeholders})",
            [record[c] for c in cols],
        )
    conn.close()


def update_sale(sale_id: int, record: dict):
    conn = get_conn()
    cols = [c for c in RAW_SALES_COLUMNS if c in record]
    set_clause = ",".join(f"{c}=?" for c in cols)
    with conn:
        conn.execute(
            f"UPDATE raw_sales SET {set_clause} WHERE id=?",
            [record[c] for c in cols] + [sale_id],
        )
    conn.close()


def delete_sale(sale_id: int):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM raw_sales WHERE id=?", (sale_id,))
    conn.close()


def bulk_insert_sales(df: pd.DataFrame, mode="append"):
    conn = get_conn()
    with conn:
        if mode == "replace":
            conn.execute("DELETE FROM purchase_orders")
            conn.execute("DELETE FROM raw_sales")
        df_copy = df.copy()
        df_copy["date"] = df_copy["date"].astype(str)
        if "store_id" not in df_copy.columns:
            df_copy["store_id"] = "S001"
        cols = [c for c in RAW_SALES_COLUMNS if c in df_copy.columns]
        df_copy[cols].to_sql("raw_sales", conn, if_exists="append", index=False)
    conn.close()


def list_recent_sales(limit=100, product_id=None, store_id=None):
    conn = get_conn()
    q = "SELECT r.*, p.name as product_name FROM raw_sales r LEFT JOIN products p ON r.product_id = p.product_id WHERE 1=1"
    params = []
    if product_id:
        q += " AND r.product_id=?"
        params.append(product_id)
    if store_id and store_id != "all":
        q += " AND r.store_id=?"
        params.append(store_id)
    q += " ORDER BY r.date DESC, r.id DESC LIMIT ?"
    params.append(limit)
    df = pd.read_sql(q, conn, params=params)
    conn.close()
    return df


# ---------------------------------------------------------------------------
# Purchase Orders CRUD
# ---------------------------------------------------------------------------
def create_purchase_order(po_id, store_id, product_id, supplier_id, order_qty, order_date, expected_date=None, notes=""):
    conn = get_conn()
    with conn:
        conn.execute("""
            INSERT INTO purchase_orders (po_id, store_id, product_id, supplier_id, order_qty, order_date, expected_date, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
        """, (po_id, store_id, product_id, supplier_id, order_qty, order_date, expected_date, notes))
    conn.close()


def update_purchase_order_status(po_id, status):
    conn = get_conn()
    with conn:
        conn.execute("UPDATE purchase_orders SET status=? WHERE po_id=?", (status, po_id))
    conn.close()


def load_purchase_orders(store_id=None):
    conn = get_conn()
    q = """
        SELECT po.*, p.name as product_name, p.price, s.name as store_name, sup.name as supplier_name, sup.lead_time_days
        FROM purchase_orders po
        JOIN products p ON po.product_id = p.product_id
        JOIN stores s ON po.store_id = s.store_id
        JOIN suppliers sup ON po.supplier_id = sup.supplier_id
    """
    params = []
    if store_id and store_id != "all":
        q += " WHERE po.store_id=?"
        params.append(store_id)
    q += " ORDER BY po.order_date DESC, po.po_id DESC"
    df = pd.read_sql(q, conn, params=params)
    conn.close()
    if not df.empty:
        df["lead_time_days"] = df["lead_time_days"].fillna(5).astype(int)
        df["expected_date"] = df["expected_date"].fillna("")
        df["notes"] = df["notes"].fillna("")
    return df


# ---------------------------------------------------------------------------
# User Management & Auth
# ---------------------------------------------------------------------------
def get_user_by_username(username: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_api_key(api_key: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE api_key = ?", (api_key,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def list_users():
    conn = get_conn()
    df = pd.read_sql("SELECT id, username, role, api_key, created_at FROM users ORDER BY id", conn)
    conn.close()
    return df


def create_user(username, password, role="Viewer", api_key=None):
    conn = get_conn()
    pwd_hash = generate_password_hash(password)
    if not api_key:
        api_key = f"key-{username}-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
    with conn:
        conn.execute("INSERT INTO users (username, password_hash, role, api_key) VALUES (?, ?, ?, ?)",
                     (username, pwd_hash, role, api_key))
    conn.close()


def delete_user(user_id: int):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.close()


# ---------------------------------------------------------------------------
# Model Versions & Governance
# ---------------------------------------------------------------------------
def record_model_version(version_id, mae, rmse, artifact_path, training_rows, feature_importances_str, is_active=1):
    conn = get_conn()
    with conn:
        if is_active:
            conn.execute("UPDATE model_versions SET is_active=0")
        conn.execute("""
            INSERT INTO model_versions (version_id, created_at, mae, rmse, is_active, artifact_path, training_rows, feature_importances)
            VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)
        """, (version_id, mae, rmse, is_active, artifact_path, training_rows, feature_importances_str))
    conn.close()


def list_model_versions():
    conn = get_conn()
    df = pd.read_sql("SELECT * FROM model_versions ORDER BY created_at DESC", conn)
    conn.close()
    return df


def set_active_model_version(version_id: str):
    conn = get_conn()
    cur = conn.cursor()
    with conn:
        cur.execute("SELECT * FROM model_versions WHERE version_id=?", (version_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return None
        conn.execute("UPDATE model_versions SET is_active=0")
        conn.execute("UPDATE model_versions SET is_active=1 WHERE version_id=?", (version_id,))
    conn.close()
    return dict(row)


def get_active_model_version():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM model_versions WHERE is_active=1 ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Audit Logs
# ---------------------------------------------------------------------------
def add_audit_log(username, action, entity_type, entity_id=None, details=""):
    conn = get_conn()
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with conn:
        conn.execute("""
            INSERT INTO audit_logs (timestamp, username, action, entity_type, entity_id, details)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (ts, username, action, entity_type, str(entity_id) if entity_id is not None else None, details))
    conn.close()


def list_audit_logs(limit=100):
    conn = get_conn()
    df = pd.read_sql("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", conn, params=[limit])
    conn.close()
    return df


# ---------------------------------------------------------------------------
# Backup Routine
# ---------------------------------------------------------------------------
def backup_db():
    cfg = get_config()
    backup_dir = os.path.join(os.path.dirname(cfg.DB_PATH), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_dir, f"retail_demand_backup_{ts}.db")
    
    conn = get_conn()
    backup_conn = sqlite3.connect(backup_path)
    conn.backup(backup_conn)
    backup_conn.close()
    conn.close()
    return backup_path
