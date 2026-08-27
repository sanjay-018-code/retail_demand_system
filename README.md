# Local Retail Demand Prediction System

A working, **dynamic** prototype for Hackathon Problem 8. Predicts short-term
product demand, separates festival/promotion-driven spikes from normal baseline
demand, and raises stock-out / overstock alerts by comparing predictions with
current stock.

**Dynamic = SQLite is the live source of truth.** Every change — uploading a
CSV, adding/editing a product, recording a new sale — writes straight to the
database and automatically re-cleans + retrains the model in the background.
The dashboard polls for changes every few seconds, so it reflects new data
without a manual refresh.

## Tech Stack (implemented)
- **Backend:** Python + Flask
- **Data processing:** Pandas, NumPy
- **Machine Learning:** Scikit-learn (RandomForestRegressor)
- **Database:** SQLite
- **Frontend:** HTML, CSS, JavaScript (Bootstrap 5)
- **Visualization:** Chart.js

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the app (first run auto-generates sample data, cleans it,
#    trains the model, and populates SQLite)
python run.py

# 3. Open the dashboard
http://localhost:5000
```

No manual setup steps are needed — `data/historical_sales.csv`,
`data/product_master.csv`, `data/retail_demand.db` and the trained model
(`app/models/demand_model.joblib`) are all generated automatically on first run.
Delete any of them and restart to regenerate from scratch.

## Using Your Own Data — No File Editing Needed

Open the **"Manage Data"** tab in the dashboard. From there you can:

- **Upload a CSV** of real sales history (append to existing data, or replace
  it entirely). Required columns: `product_id, date, quantity_sold,
  current_stock`. Optional: `product_name, category, price, promotion,
  festival_event, weather`. Unknown `product_id`s are auto-registered as new
  products.
- **Add / update a product** through a form (ID, name, category, price, stock).
- **Record a sale** one at a time — pick the product, date, quantity sold,
  resulting stock, and optionally mark it as a festival/event or promotion day.
- **Delete** any product or sales record with one click.

Every action above triggers an automatic clean → retrain cycle (usually under
a second for this dataset size), and the dashboard refreshes on its own —
no server restart, no CSV editing, no manual retrain button needed (though
`POST /api/retrain` still exists if you want to force it).

## Project Structure

```
retail_demand_system/
├── run.py                        # entry point
├── requirements.txt
├── README.md
├── IMPLEMENTATION_REPORT.md       # detailed status report
├── data/                          # generated CSVs + SQLite DB (auto-created)
└── app/
    ├── main.py                    # Flask app + all API routes
    ├── db.py                      # SQLite persistence
    ├── models/
    │   └── predictor.py           # ML demand prediction engine
    ├── utils/
    │   ├── data_generator.py      # synthetic sample data (swap for real POS data)
    │   ├── data_cleaning.py       # cleaning & validation
    │   ├── demand_analysis.py     # daily/weekly demand, fast/slow movers
    │   └── stock_alerts.py        # stock-out / overstock logic
    ├── templates/index.html       # dashboard UI
    └── static/{css,js}            # dashboard styling & logic
```

## API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/overview` | Summary KPIs + data quality report |
| `GET /api/products` | Product master list |
| `GET /api/demand/daily?product_id=` | Daily demand series |
| `GET /api/demand/weekly?product_id=` | Weekly demand series |
| `GET /api/movers?recent_days=30` | Fast/slow/medium moving classification |
| `GET /api/predict/<product_id>?horizon=7&festivals=YYYY-MM-DD` | Demand forecast (baseline vs. event-adjusted) |
| `GET /api/alerts?horizon=7` | Stock-out / overstock alerts for all products |
| `GET /api/status` | Lightweight version counter the frontend polls to detect changes |
| `POST /api/upload` | Upload a sales CSV (multipart form: `file`, `mode=append\|replace`) |
| `GET/POST /api/manage/products` | List / create-or-update products |
| `DELETE /api/manage/products/<id>` | Delete a product and its sales |
| `GET/POST /api/manage/sales` | List recent sales / add a sale record |
| `PUT/DELETE /api/manage/sales/<id>` | Edit / delete a sales record |
| `POST /api/retrain` | Force a clean + retrain cycle (normally automatic) |

See `IMPLEMENTATION_REPORT.md` for what's implemented, assumptions made, and
what would need to change to go from prototype to full production use.
