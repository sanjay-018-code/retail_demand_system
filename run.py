"""
Application Launcher
====================
Run with:  python run.py
Then open http://localhost:5000 in your browser.
"""
from app.main import app
from app.config import get_config

cfg = get_config()

if __name__ == "__main__":
    app.run(host=cfg.HOST, port=cfg.PORT, debug=cfg.DEBUG)
