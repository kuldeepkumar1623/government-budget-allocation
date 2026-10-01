# Government Budget Allocation Analyzer

A local-first Government Budget Allocation Analyzer. The React frontend and FastAPI backend run independently and communicate through JSON APIs. Upload a CSV, Excel, or JSON budget dataset; the backend cleans and analyzes it, and the dashboard visualizes the results and exports filtered data. The included sample CSV loads automatically when the backend starts.

## Project structure

```text
government-budget-allocation/
|-- backend/
|   |-- main.py
|   |-- requirements.txt
|   |-- .env
|   |-- data/
|   |   `-- sample_budget.csv
|   |-- models/
|   |   |-- __init__.py
|   |   `-- schemas.py
|   |-- routes/
|   |   |-- __init__.py
|   |   `-- api.py
|   |-- services/
|   |   |-- __init__.py
|   |   |-- analysis.py
|   |   `-- dataset_store.py
|   `-- utils/
|       |-- __init__.py
|       `-- cleaning.py
|-- frontend/
|   |-- index.html
|   |-- styles.css
|   |-- .env
|   |-- package.json
|   |-- package-lock.json
|   |-- vite.config.js
|   `-- src/
|       |-- App.jsx
|       `-- main.jsx
|-- README.md
`-- .gitignore
```

## Run both apps in VS Code (Windows PowerShell)

Open the project root in VS Code. Use two separate integrated terminals.

### Terminal 1: backend

Python 3.10 or newer is recommended.

   ```powershell
   cd backend
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8080
   ```

The backend runs at `http://127.0.0.1:8080`; interactive API documentation is at `http://127.0.0.1:8080/docs`. If port 8000 is available on your machine, you can omit `--port 8080` and change `VITE_API_BASE_URL` in `frontend/.env` to `http://127.0.0.1:8000/api`.

If PowerShell blocks venv activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal and activate again. On macOS/Linux, replace venv creation/activation with `python3 -m venv .venv` and `source .venv/bin/activate`.

### Terminal 2: React frontend

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

Open Vite's printed URL, normally `http://127.0.0.1:5173`. Vite is required to compile React JSX; Live Server alone cannot run this frontend.

## How the apps connect

The React app reads `VITE_API_BASE_URL` from `frontend/.env` (default `http://127.0.0.1:8080/api` in this workspace). The Python service reads `CORS_ORIGINS` and `LOG_LEVEL` from `backend/.env`; the Vite origin is allowed by default. The browser sends filter selections and `dataset_id` to FastAPI. FastAPI stores uploaded files under `backend/data/`, cleans the columns and values, computes the analysis, and returns JSON for dashboard charts and tables. CSV or Excel downloads use the same active filters. Restart the relevant server after changing its `.env` file.

Uploads are limited to 20 MB and accepted as `.csv`, `.xlsx`, `.xls`, or `.json`. Files are saved with generated safe names. The saved-file loader accepts only a filename, resolves within `backend/data/`, and rejects traversal attempts. Dataset metadata and the active registry are held in memory; each upload receives a fresh `dataset_id`, and the sample dataset loads at API startup.

## API overview

All analysis endpoints accept optional `dataset_id`, `year`, `department`, `sector`, and `region` query parameters.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/files` | List saved files |
| POST | `/api/upload` | Upload, clean, and save a dataset |
| POST | `/api/load-file` | Load a saved file by `{ "name": "file.csv" }` |
| GET | `/api/options` | Filter options for a dataset |
| GET | `/api/summary` | Budget, spending, utilization, departments, and year range |
| GET | `/api/by-department` | Allocated and spent totals by department |
| GET | `/api/by-sector` | Allocation share by sector |
| GET | `/api/by-region` | Allocated and spent totals by region |
| GET | `/api/trends` | Annual allocation, spending, and allocation growth |
| GET | `/api/top-bottom` | Top and bottom departments and schemes |
| GET | `/api/anomalies` | IQR allocation outliers, under-60%, and over-100% utilization |
| GET | `/api/insights` | Plain-English observations |
| GET | `/api/table` | Searchable, sortable, paginated cleaned data |
| GET | `/api/export?format=csv` | Download filtered cleaned data as CSV or Excel (`format=xlsx`) |

## Data cleaning and expected columns

The standard fields are `Year`, `Department`, `Sector`, `State/Region`, `Scheme`, `Allocated_Amount`, `Spent_Amount`, and `Revised_Estimate`. Column names are matched case-insensitively against common aliases. Missing text fields receive explicit labels; invalid or missing numeric amounts become zero; duplicate rows are removed; currency symbols and comma separators are accepted in amount fields. Missing columns are added with safe defaults, so the dataset remains analyzable even when optional fields are absent.

The included `backend/data/sample_budget.csv` has 50 records across 2020–2024 and can exercise the charts and filters. Amounts are example INR values, not official government figures.

## Future improvements

- Add user authentication, role-based access, and audit trails.
- Persist datasets and analysis metadata in PostgreSQL instead of process memory.
- Add configurable anomaly thresholds, robust time-series forecasting, and budget-vs-revised estimates.
- Generate downloadable PDF reports and scheduled summaries.
- Add server-side upload quotas, retention controls, and background processing for larger datasets.