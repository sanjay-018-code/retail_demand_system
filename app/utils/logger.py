"""
Structured Logging & Error Tracking
====================================
Logs events to console and logfile with timestamps, levels, and contextual details.
"""
import logging
import os
import sys
from app.config import get_config

cfg = get_config()

logger = logging.getLogger("retail_demand")
logger.setLevel(getattr(logging, cfg.LOG_LEVEL.upper(), logging.INFO))

if not logger.handlers:
    # Console handler
    c_handler = logging.StreamHandler(sys.stdout)
    c_handler.setLevel(getattr(logging, cfg.LOG_LEVEL.upper(), logging.INFO))
    c_format = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
    c_handler.setFormatter(c_format)
    logger.addHandler(c_handler)
    
    # File handler
    try:
        f_handler = logging.FileHandler(cfg.LOG_FILE, encoding="utf-8")
        f_handler.setLevel(getattr(logging, cfg.LOG_LEVEL.upper(), logging.INFO))
        f_format = logging.Formatter('{"time":"%(asctime)s", "level":"%(levelname)s", "module":"%(module)s", "message":"%(message)s"}')
        f_handler.setFormatter(f_format)
        logger.addHandler(f_handler)
    except Exception as e:
        logger.warning(f"Could not initialize file logger at {cfg.LOG_FILE}: {e}")
