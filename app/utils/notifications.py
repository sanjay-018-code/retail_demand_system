"""
Alerting & Webhook Dispatcher
=============================
Requirement #25: Push stock-out and overstock alerts to webhooks (Slack/Teams/HTTP)
or log/email notifications.
"""
import requests
import json
from app.utils.logger import logger

def dispatch_webhook_alert(webhook_url: str, alert_data: dict) -> dict:
    """
    Sends structured alert payload to a webhook URL.
    Compatible with Slack / Microsoft Teams / Custom Webhook receivers.
    """
    if not webhook_url:
        return {"status": "error", "message": "No webhook URL provided"}
    
    payload = {
        "text": f"🚨 *Retail Demand Alert* | {alert_data.get('product_name')} ({alert_data.get('status')})",
        "attachments": [
            {
                "color": "#e63946" if alert_data.get("status") == "Stock-Out Risk" else "#f4a261",
                "fields": [
                    {"title": "Product", "value": f"{alert_data.get('product_name')} ({alert_data.get('product_id')})", "short": True},
                    {"title": "Status", "value": alert_data.get("status"), "short": True},
                    {"title": "Current Stock", "value": str(alert_data.get("current_stock")), "short": True},
                    {"title": "Predicted Demand", "value": str(alert_data.get("predicted_demand_horizon")), "short": True},
                    {"title": "Action", "value": alert_data.get("alert") or "Monitor stock", "short": False},
                ]
            }
        ]
    }
    
    try:
        resp = requests.post(webhook_url, json=payload, timeout=5)
        logger.info(f"Webhook dispatched to {webhook_url} (HTTP {resp.status_code})")
        return {"status": "success", "http_status": resp.status_code}
    except Exception as e:
        logger.error(f"Failed to dispatch webhook to {webhook_url}: {e}")
        return {"status": "error", "message": str(e)}
