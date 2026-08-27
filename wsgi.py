"""
WSGI Application Entry Point
============================
Used for production deployments behind reverse proxies (Nginx / IIS / Caddy)
with Gunicorn (Linux) or Waitress (Windows).
"""
from app.main import app

if __name__ == "__main__":
    from app.config import get_config
    import sys
    cfg = get_config()
    
    if sys.platform.startswith("win"):
        try:
            from waitress import serve
            print(f"[*] Starting production Waitress WSGI server on http://{cfg.HOST}:{cfg.PORT}")
            serve(app, host=cfg.HOST, port=cfg.PORT)
        except ImportError:
            print("[!] Waitress not installed, falling back to app.run")
            app.run(host=cfg.HOST, port=cfg.PORT, debug=cfg.DEBUG)
    else:
        app.run(host=cfg.HOST, port=cfg.PORT, debug=cfg.DEBUG)
