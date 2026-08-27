"""
Authentication & Role-Based Access Control (RBAC)
=================================================
Requirements #10 & #11.
Roles:
  - Viewer: Read-only access to dashboard, forecasts, KPIs, alerts.
  - Manager: Viewer + CRUD sales/products, PO creation, trigger retraining.
  - Admin: Manager + User management, replace-mode bulk uploads, rollback model, audit logs.
"""
from functools import wraps
import time
from collections import defaultdict
from flask import session, request, jsonify
from werkzeug.security import check_password_hash
from app import db
from app.config import get_config
from app.utils.logger import logger

# In-memory IP/Client rate limiter (Token Bucket / Sliding Window)
_rate_limits = defaultdict(list)


def get_current_user():
    """Retrieve logged-in user from session or API Key header/params."""
    # 1. Check API Key
    api_key = request.headers.get("X-API-Key") or request.args.get("api_key")
    if not api_key:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            api_key = auth_header[7:].strip()
            
    if api_key:
        user = db.get_user_by_api_key(api_key)
        if user:
            return user

    # 2. Check Session
    username = session.get("username")
    if username:
        user = db.get_user_by_username(username)
        if user:
            return user

    return None


def rate_limit(max_requests=None, window_seconds=60):
    """Simple sliding window rate limiter decorator."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            cfg = get_config()
            limit = max_requests or cfg.RATE_LIMIT_MUTATIONS
            client_ip = request.remote_addr or "127.0.0.1"
            now = time.time()
            
            # Clean expired timestamps
            timestamps = [t for t in _rate_limits[client_ip] if now - t < window_seconds]
            if len(timestamps) >= limit:
                logger.warning(f"Rate limit exceeded for IP {client_ip} on {request.path}")
                return jsonify({"error": "Rate limit exceeded. Please slow down.", "status_code": 429}), 429
            
            timestamps.append(now)
            _rate_limits[client_ip] = timestamps
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required. Please log in or provide X-API-Key.", "status_code": 401}), 401
        return fn(*args, **kwargs)
    return wrapper


def role_required(allowed_roles):
    """Enforce RBAC role check. allowed_roles can be list or string."""
    if isinstance(allowed_roles, str):
        allowed_roles = [allowed_roles]

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if not user:
                return jsonify({"error": "Authentication required. Please log in or provide X-API-Key.", "status_code": 401}), 401
            
            if user["role"] not in allowed_roles:
                logger.warning(f"Forbidden access: User {user['username']} ({user['role']}) tried to access {request.path} requiring {allowed_roles}")
                return jsonify({
                    "error": f"Access forbidden: requires role in {allowed_roles}, but your role is '{user['role']}'",
                    "status_code": 403
                }), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def authenticate_user(username, password):
    user = db.get_user_by_username(username)
    if not user:
        return None
    if check_password_hash(user["password_hash"], password):
        return user
    return None
