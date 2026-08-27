"""
Configuration Management for Retail Demand Prediction System
=============================================================
Supports Dev, Staging, and Production profiles via environment variables.
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Config:
    ENV = os.getenv("FLASK_ENV", "production")
    DEBUG = os.getenv("FLASK_DEBUG", "0") in ("1", "true", "True")
    TESTING = False
    SECRET_KEY = os.getenv("SECRET_KEY", "retail-demand-secret-key-change-in-prod")
    
    # DB configuration
    DB_PATH = os.getenv("DB_PATH", os.path.join(BASE_DIR, "data", "retail_demand.db"))
    
    # Model storage & versioning
    MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(BASE_DIR, "app", "models", "versions"))
    ACTIVE_MODEL_PATH = os.path.join(BASE_DIR, "app", "models", "demand_model.joblib")
    
    # Upload limits (20MB)
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", 20 * 1024 * 1024))
    
    # Model evaluation thresholds
    MAX_RMSE_DEGRADATION_RATIO = float(os.getenv("MAX_RMSE_DEGRADATION_RATIO", "0.20"))  # Reject if >20% worse
    
    # Rate Limiting (in-memory token bucket)
    RATE_LIMIT_MUTATIONS = int(os.getenv("RATE_LIMIT_MUTATIONS", 120))  # requests per minute
    
    # Server configuration
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", 5000))
    
    # Logging
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE = os.getenv("LOG_FILE", os.path.join(BASE_DIR, "retail_system.log"))

class DevConfig(Config):
    ENV = "development"
    DEBUG = True

class TestConfig(Config):
    ENV = "testing"
    TESTING = True
    DB_PATH = os.path.join(BASE_DIR, "data", "test_retail_demand.db")
    ACTIVE_MODEL_PATH = os.path.join(BASE_DIR, "app", "models", "test_demand_model.joblib")

def get_config():
    env = os.getenv("APP_ENV", os.getenv("FLASK_ENV", "production")).lower()
    if env in ("test", "testing"):
        return TestConfig
    elif env in ("dev", "development"):
        return DevConfig
    return Config
